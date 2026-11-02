"""Live check of the drone-fix builders in Fusion (run it as a Fusion script, or through the Fusion MCP).
Makes a throw-away design with a 2.5 in x 0.065 in main pipe along X (a solid tube), then builds with the installed
add-in's own actions (a fresh copy of cadtools.py, so a running older add-in does not matter):
  can      a Helmholtz can from a marker on top of the pipe, the marker and the pipe's outside face selected
  path     a J-pipe along a sketched line from the pipe's top, capped and coped
  route    a J-pipe auto-routed from a marker on the pipe to a marker where the cap goes, the pipe as the keep-out
  tilt     a J-pipe along a line 5 deg off square: its first part, inside the main pipe, has to be cut away
  scan     an outside-only mesh of the pipe as the keep-out (the solid hidden): the can, and a J-pipe the size of
           the main pipe, both coped to a main pipe read from the scan
  hole     the hole tools actually cut from the main pipe (Combine > Cut, as the user would)
Each is checked in Fusion's own numbers: body volumes against the revolved sections, the coped end meeting the main
pipe without running into it and adding to the tube, the cap's place, the hidden hole tool and what it cuts. Prints
JSON (ok per test and the numbers behind it), then closes the design without saving. Fusion calls run(context)
after importing a script; the call at the bottom is for running it as plain code (the Fusion connector), and the
guard makes it run once either way."""
import importlib.util
import json
import os
import sys
import tempfile
import traceback

import adsk.core
import adsk.fusion

R, RIN, LEN = 3.175, 3.0099, 80.0          # cm: 2.5 in OD x 0.065 in wall, 80 cm long along +X from the origin


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
        for mod in ('router', 'templates'):        # fresh copies from the add-in folder, not ones left from a run before
            sys.modules.pop(mod, None)
        spec = importlib.util.spec_from_file_location('cadtools_live_drone', os.path.join(folder, 'cadtools.py'))
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._app, ct._ui = app, ui
        TPL = ct.TPL
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        tbm = adsk.fusion.TemporaryBRepManager.get()
        P = lambda x, y, z: adsk.core.Point3D.create(x, y, z)

        sk = root.sketches.add(root.yZConstructionPlane)
        o = sk.modelToSketchSpace(P(0, 0, 0))
        sk.sketchCurves.sketchCircles.addByCenterRadius(o, R)
        sk.sketchCurves.sketchCircles.addByCenterRadius(o, RIN)
        ring = [sk.profiles.item(i) for i in range(sk.profiles.count) if sk.profiles.item(i).profileLoops.count == 2][0]
        main = root.features.extrudeFeatures.addSimple(ring, adsk.core.ValueInput.createByReal(LEN),
                                                       adsk.fusion.FeatureOperations.NewBodyFeatureOperation).bodies.item(0)
        main.name = 'Main pipe'
        cyls = [main.faces.item(i) for i in range(main.faces.count)
                if main.faces.item(i).geometry.surfaceType == adsk.core.SurfaceTypes.CylinderSurfaceType]
        outside = max(cyls, key=lambda f: f.geometry.radius)
        out['main_pipe'] = {'x_range': [main.boundingBox.minPoint.x, main.boundingBox.maxPoint.x], 'outside_r': outside.geometry.radius}

        def line(p0, p1, name):
            s = root.sketches.add(root.xZConstructionPlane)     # every marker here lies in y = 0
            s.name = name
            return s.sketchCurves.sketchLines.addByTwoPoints(s.modelToSketchSpace(P(*p0)), s.modelToSketchSpace(P(*p1)))

        def select(ents):
            ui.activeSelections.clear()
            for e in ents:
                ui.activeSelections.add(e)

        def overlap(a, b):
            ca, cb = tbm.copy(a), tbm.copy(b)
            if not tbm.booleanOperation(ca, cb, adsk.fusion.BooleanTypes.IntersectionBooleanType):
                return 0.0
            return ca.volume

        def gap(a, b):
            return app.measureManager.measureMinimumDistance(a, b).value

        def tube_volume(L, od=6.35, wall=0.1651):
            return 3.141592653589793 / 4.0 * (od ** 2 - (od - 2 * wall) ** 2) * L

        def comp_named(name):
            for i in range(root.occurrences.count):
                c = root.occurrences.item(i).component
                if c.name == name:
                    return c
            return root

        def bodies(c):
            return {c.bRepBodies.item(i).name: c.bRepBodies.item(i) for i in range(c.bRepBodies.count)}

        def test(name, fn):
            try:
                r = fn()
                r['ok'] = all(v for k, v in r.items() if k.startswith('ok_'))
            except Exception:
                r = {'ok': False, 'error': traceback.format_exc()}
            out['tests'][name] = r

        can_data = {'neck_id_mm': 50.8, 'neck_len_mm': 76.2, 'wall_mm': 1.651, 'can_id_mm': 127.0, 'vol_cm3': 2934.0,
                    'can_wall_mm': 1.519, 'neck_into_mm': 25.4, 'gap_cm': 1.27, 'main_od_mm': 63.5}
        lay = TPL.helm_can(5.08, 0.1651, 7.62, 12.7, 2934.0, 0.1519, 2.54)

        def t_can():
            mk = line((20.0, 0.0, R), (20.0, 0.0, R + 2.0), 'Neck marker')
            select([mk, outside])
            res = ct.act_helmholtz(dict(can_data, title='Helmholtz can'))
            b = bodies(comp_named('Helmholtz can'))
            can, neck, hole = b.get('Helmholtz can'), b.get('Helmholtz can neck'), b.get('Helmholtz can neck tee hole (cut tool)')
            r = {'msg': res.get('msg'), 'bodies': sorted(b)}
            r['can_volume'] = can.volume if can else None
            r['can_volume_want'] = TPL.revolved_volume(lay['section'])
            r['ok_can_volume'] = bool(can) and abs(can.volume - r['can_volume_want']) < 1e-3 * r['can_volume_want']
            tube = TPL.revolved_volume(lay['neck'])
            r['neck_volume'], r['neck_tube_volume'] = (neck.volume if neck else None), tube
            r['ok_coped_and_joined'] = bool(neck) and 'Helmholtz can neck coped end' not in b and neck.volume > tube + 0.05
            r['ok_hole_hidden'] = bool(hole) and hole.isLightBulbOn is False
            if neck:
                r['neck_gap'], r['neck_overlap'] = gap(neck, main), overlap(neck, main)
                r['ok_neck_meets_main'] = r['neck_gap'] < 0.005 and r['neck_overlap'] < 0.01
            if can:
                r['can_gap'] = gap(can, main)
                r['ok_can_clears_main'] = abs(r['can_gap'] - lay['gap']) < 0.01
            if hole:
                r['hole_cuts'] = overlap(hole, main)
                r['ok_hole_cuts_the_wall'] = r['hole_cuts'] > 0.1
            r['ok_reported'] = bool(res.get('ok')) and abs(res['items'][0]['helm']['gas_cm3'] - 2934.0) < 1e-6
            return r

        def t_path():
            ln = line((45.0, 0.0, R), (45.0, 0.0, R + 30.0), 'J-pipe path')
            select([ln, outside])
            res = ct.act_pipe({'od_mm': 63.5, 'wall_mm': 1.651, 'noun': 'J-pipe', 'title': 'J-pipe', 'target_mm': 300.0,
                               'cap': True, 'tee': True, 'cap_mm': 3.175})
            b = bodies(root)
            jp, cap, hole = b.get('J-pipe 1'), b.get('J-pipe cap'), b.get('J-pipe tee hole (cut tool)')
            r = {'msg': res.get('msg'), 'note': (res.get('items') or [{}])[0].get('note'), 'bodies': sorted(b)}
            if cap:
                bb = cap.boundingBox
                r['cap_z'] = [bb.minPoint.z, bb.maxPoint.z]
                r['ok_cap_on_the_end'] = abs(bb.minPoint.z - (R + 30.0)) < 1e-3 and abs(bb.maxPoint.z - (R + 30.3175)) < 1e-3
            else:
                r['ok_cap_on_the_end'] = False
            plain = tube_volume(30.0)
            r['jpipe_volume'], r['plain_tube_volume'] = (jp.volume if jp else None), plain
            r['ok_coped_and_joined'] = (bool(jp) and 'J-pipe coped end' not in b and jp.volume > plain + 0.05
                                        and 'is coped to the main pipe' in (r['note'] or ''))
            if jp:
                r['jpipe_gap'], r['jpipe_overlap'] = gap(jp, main), overlap(jp, main)
                r['ok_meets_main'] = r['jpipe_gap'] < 0.005 and r['jpipe_overlap'] < 0.01
            r['ok_hole_hidden'] = bool(hole) and hole.isLightBulbOn is False
            return r

        def t_route():
            select([main])
            ct.act_set_keepouts({})
            s = line((10.0, 0.0, R), (10.0, 0.0, R + 2.0), 'J-pipe start')
            e = line((25.0, 0.0, 14.0), (27.0, 0.0, 14.0), 'J-pipe end')
            select([s, e, outside])
            res = ct.act_route({'mode': 'single', 'title': 'J-pipe', 'od_mm': 63.5, 'wall_mm': 1.651, 'target_mm': 601.2,
                                'cap': True, 'tee': True, 'cap_mm': 3.175, 'gap_mm': 12.7, 'main_od_mm': 63.5})
            c = comp_named('J-pipe')
            b = bodies(c)
            jp, cap = b.get('J-pipe'), b.get('J-pipe cap')
            it = (res.get('items') or [{}])[0]
            r = {'msg': res.get('msg'), 'note': it.get('note'), 'length': it.get('length'), 'bodies': sorted(b)}
            r['ok_route'] = bool(res.get('ok')) and abs((it.get('length') or 0) - 60.12) < 0.06
            if cap:
                bb = cap.boundingBox
                r['cap_x'] = [bb.minPoint.x, bb.maxPoint.x]
                r['ok_cap_on_the_end'] = abs(bb.minPoint.x - 25.0) < 1e-3 and abs(bb.maxPoint.x - 25.3175) < 1e-3
            else:
                r['ok_cap_on_the_end'] = False
            plain = tube_volume(it.get('length') or 0.0)
            r['jpipe_volume'], r['plain_tube_volume'] = (jp.volume if jp else None), plain
            r['ok_coped_and_joined'] = (bool(jp) and 'J-pipe coped end' not in b and jp.volume > plain + 0.05
                                        and 'is coped to the main pipe' in (r['note'] or '') and 'J-pipe tee hole (cut tool)' in b)
            if jp:
                r['jpipe_gap'], r['jpipe_overlap'] = gap(jp, main), overlap(jp, main)
                r['ok_meets_main'] = r['jpipe_gap'] < 0.005 and r['jpipe_overlap'] < 0.01
            return r

        def t_tilt():
            import math
            a = math.radians(5.0)
            ln = line((32.0, 0.0, R), (32.0 + 25.0 * math.sin(a), 0.0, R + 25.0 * math.cos(a)), 'J-pipe 5 deg off square')
            select([ln, outside])
            res = ct.act_pipe({'od_mm': 63.5, 'wall_mm': 1.651, 'noun': 'J-pipe', 'title': 'J-pipe tilted', 'target_mm': 250.0,
                               'cap': True, 'tee': True, 'cap_mm': 3.175})
            b = bodies(root)
            jp = b.get('J-pipe tilted 1')
            note = (res.get('items') or [{}])[0].get('note') or ''
            r = {'msg': res.get('msg'), 'note': note, 'bodies': sorted(b)}
            r['ok_cut_to_the_main_pipe'] = 'off square' in note and 'J-pipe tilted main pipe outside (cut tool)' not in b
            if jp:
                r['jpipe_overlap'], r['jpipe_gap'] = overlap(jp, main), gap(jp, main)
                r['ok_no_overlap'] = r['jpipe_overlap'] < 0.01 and r['jpipe_gap'] < 0.005
            else:
                r['ok_no_overlap'] = False
            return r

        def t_scan():
            # an outside-only scan, as a real one is: a solid rod the size of the pipe, exported and read back as a mesh
            sk2 = root.sketches.add(root.yZConstructionPlane)
            sk2.sketchCurves.sketchCircles.addByCenterRadius(sk2.modelToSketchSpace(P(0, 0, 0)), R)
            rod = root.features.extrudeFeatures.addSimple(sk2.profiles.item(0), adsk.core.ValueInput.createByReal(LEN),
                                                          adsk.fusion.FeatureOperations.NewBodyFeatureOperation).bodies.item(0)
            path = os.path.join(tempfile.gettempdir(), 'et_live_main_pipe.stl')
            em = app.exportManager
            opts = em.createSTLExportOptions(rod, path)
            opts.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh
            em.execute(opts)
            rod.isLightBulbOn = False
            mesh = None
            for units in (adsk.fusion.MeshUnits.MillimeterMeshUnit, adsk.fusion.MeshUnits.CentimeterMeshUnit):
                n0 = root.meshBodies.count
                bf = root.features.baseFeatures.add()
                bf.startEdit()
                try:
                    root.meshBodies.add(path, units, bf)
                finally:
                    bf.finishEdit()
                m = root.meshBodies.item(n0) if root.meshBodies.count > n0 else None     # read again after finishEdit
                if m and abs(m.boundingBox.maxPoint.x - LEN) < 0.5:
                    mesh = m
                    break
                if m:
                    m.deleteMe()
            if mesh is None:
                return {'ok_mesh_imported': False}
            main.isLightBulbOn = False                       # the scan is all there is now
            ct._keepouts[:] = [(ct._token(mesh), 'Scan of the main pipe', mesh)]
            ct._mesh_cache.clear()
            mk = line((60.0, 0.0, R), (60.0, 0.0, R + 2.0), 'Neck marker on the scan')
            select([mk])
            res = ct.act_helmholtz(dict(can_data, title='Helmholtz can on the scan'))
            b = bodies(comp_named('Helmholtz can on the scan'))
            neck = b.get('Helmholtz can on the scan neck')
            r = {'msg': res.get('msg'), 'bodies': sorted(b), 'ok_mesh_imported': True}
            r['ok_read_from_scan'] = 'read from the scan' in (res.get('msg') or '')
            tube = TPL.revolved_volume(lay['neck'])
            r['ok_coped_and_joined'] = bool(neck) and 'Helmholtz can on the scan neck coped end' not in b and neck.volume > tube + 0.05
            can = (res.get('items') or [{}])[0]
            r['can_gap_to_scan'] = can.get('min_gap')
            r['ok_can_clearance'] = can.get('min_gap') is not None and abs(can['min_gap'] - lay['gap']) < 0.3
            # a J-pipe the size of the main pipe (the Mufflers tab's default) along a line from the scan's top
            ln = line((72.0, 0.0, R), (72.0, 0.0, R + 20.0), 'J-pipe on the scan')
            select([ln])
            res2 = ct.act_pipe({'od_mm': 63.5, 'wall_mm': 1.651, 'noun': 'J-pipe', 'title': 'J-pipe on the scan', 'target_mm': 200.0,
                                'cap': True, 'tee': True, 'cap_mm': 3.175, 'main_od_mm': 63.5})
            note = (res2.get('items') or [{}])[0].get('note') or ''
            r['jpipe_note'] = note
            r['ok_same_size_jpipe_coped'] = 'is coped to the main pipe' in note and 'from the scan' in note
            main.isLightBulbOn = True
            if neck:
                r['neck_overlap_with_pipe'] = overlap(neck, main)
                r['ok_no_overlap'] = r['neck_overlap_with_pipe'] < 0.02      # the scan's facets sit a hair inside the round pipe
            jp = bodies(root).get('J-pipe on the scan 1')
            if jp:
                r['jpipe_overlap_with_pipe'] = overlap(jp, main)
                r['ok_jpipe_no_overlap'] = r['jpipe_overlap_with_pipe'] < 0.02
            return r

        def t_hole():
            # cut every hole tool from the main pipe, as the user would: Combine > Cut, Keep Tools off
            tools = []
            for c in [root] + [root.occurrences.item(i).component for i in range(root.occurrences.count)]:
                occ = None
                if c != root:
                    occs = root.allOccurrencesByComponent(c)
                    occ = occs.item(0) if occs.count else None
                for i in range(c.bRepBodies.count):
                    bb = c.bRepBodies.item(i)
                    if bb.name.endswith('tee hole (cut tool)'):
                        tools.append(bb.createForAssemblyContext(occ) if occ is not None else bb)   # tools in the root's frame
            v0 = main.volume
            each = []
            for t in tools:
                each.append({'tool': t.name, 'cuts': overlap(t, main)})
            r = {'tools': len(tools), 'each': each, 'volume_before': v0}
            coll = adsk.core.ObjectCollection.create()
            for t in tools:
                coll.add(t)
            ci = root.features.combineFeatures.createInput(main, coll)
            ci.operation = adsk.fusion.FeatureOperations.CutFeatureOperation
            ci.isKeepToolBodies = True
            root.features.combineFeatures.add(ci)
            r['volume_after'] = main.volume
            r['ok_every_tool_cuts'] = len(tools) >= 4 and all(e['cuts'] > 0.1 for e in each)
            r['ok_cut_made'] = r['volume_after'] < v0 - 0.4
            return r

        test('can', t_can)
        test('path', t_path)
        test('route', t_route)
        test('tilt', t_tilt)
        test('hole', t_hole)
        test('scan', t_scan)
        out['ok'] = all(t.get('ok') for t in out['tests'].values())
    except Exception:
        out['error'] = traceback.format_exc()
    finally:
        if doc is not None:
            try:
                doc.close(False)
            except Exception:
                pass
    print(json.dumps(out, indent=1, default=str))
    _DONE[0] = out
    return out


run()
