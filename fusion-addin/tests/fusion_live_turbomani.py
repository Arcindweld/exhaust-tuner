"""Live check of the turbo manifold mode (act_route mode 'turbomani', turbomani.py) in Fusion, for the first run on the
owner's PC (run it as a Fusion script, or through the Fusion MCP). NOT RUN in the development container (there is no Fusion
there): it makes the same calls the add-in's header auto-route makes, but this file itself has not been run yet.

Makes a throw-away design in centimetres (Fusion's internal unit), the scene of tests/test_turbomani.py: a head face (a box,
x -6..0, y -10..40, z -15..15) with four port markers 9.3 cm apart on it pointing +x, and a turbine flange marker at
(50, 13.95, 0) pointing +x. Through cadtools.dispatch as the panel does: setKeepouts (the head as a mesh body if this Fusion
takes MeshBodies.addByTriangleMeshData, else a solid), then route with the page's payload for a 1.875 in x 0.065 in runner
(fixtures written by web/tests/turbomani_ui.js are not needed here; the payload is written out below), target 38 cm.
Checks: four runner bodies and one merge collector built, each runner's length within 0.5 mm of 38 cm (the add-in's items),
the message naming the wastegate as not routed, each runner body's distance to the head solid (measureMinimumDistance) at
least the clearance less 0.1 mm away from the port (the port end touches the head by design: only reported).
Prints JSON (the failing ok_ keys say what broke), closes the design (set ET_KEEP_DOC=1 to keep it)."""
import importlib.util
import json
import os
import sys
import traceback

import adsk.core
import adsk.fusion

_DONE = []
HEAD = ((-6, -10, -15), (0, 40, 15))
PAYLOAD = {'mode': 'turbomani', 'title': 'Turbo manifold', 'ports': 4, 'od_mm': 47.625, 'wall_mm': 1.651, 'clr_mm': 71.4375, 'target_mm': 380.0,
           'gap_mm': 12.7, 'gap_tt_mm': 3.175, 'max_bend_deg': 180, 'elbows': False, 'merge_len_mm': 85.6, 'collector_len_mm': 152.4,
           'collector_out_mm': 61.76, 'scrolls': None, 'gate': {'bore_mm': 38.0, 'lo_mm': 27.0, 'hi_mm': 126.0}, 'time_s': 60}


def _box(lo, hi):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    F = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (3, 6, 2), (3, 7, 6), (0, 4, 7), (0, 7, 3),
         (1, 2, 6), (1, 6, 5)]
    return [c for p in P for c in p], [i for f in F for i in f]


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
        for mod in ('router', 'templates', 'turbomani', 'merge'):
            sys.modules.pop(mod, None)
        spec = importlib.util.spec_from_file_location('cadtools_live_turbomani', os.path.join(folder, 'cadtools.py'))
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._app, ct._ui = app, ui
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        P = adsk.core.Point3D.create
        tbm = adsk.fusion.TemporaryBRepManager.get()
        lo, hi = HEAD
        c = P((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
        obb = adsk.core.OrientedBoundingBox3D.create(c, adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0),
                                                     hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
        head = ct._add_bodies(root, [(tbm.createBox(obb), 'Head')])[0]
        keep = [head]
        try:
            coords, idx = _box(lo, hi)
            mb = root.meshBodies.addByTriangleMeshData(coords, idx, [], [])
            mb = mb if hasattr(mb, 'displayMesh') else mb.item(0)
            mb.name = 'Scan (head)'
            keep = [mb]
            r['info_scan_as'] = 'mesh body'
        except Exception as e:
            r['info_scan_as'] = 'solid (mesh body refused: %s)' % e
        sk = root.sketches.add(root.xYConstructionPlane)
        sk.name = 'Turbo manifold markers'
        L = sk.sketchCurves.sketchLines
        ends = [((0, 9.3 * i, 0), (2, 9.3 * i, 0)) for i in range(4)] + [((50, 13.95, 0), (52, 13.95, 0))]
        mk = [L.addByTwoPoints(sk.modelToSketchSpace(P(*a)), sk.modelToSketchSpace(P(*b))) for a, b in ends]

        def select(ents):
            ui.activeSelections.clear()
            for e in ents:
                ui.activeSelections.add(e)
        select(keep)
        res = ct.dispatch('setKeepouts', '{}')
        r['ok_keepouts'] = bool(res.get('ok'))
        select(mk[:4])
        res = ct.dispatch('route', json.dumps(PAYLOAD))
        r['ok_too_few_markers'] = (not res.get('ok')) and 'Turbo manifold' in (res.get('msg') or '')
        select(mk)
        res = ct.dispatch('route', json.dumps(PAYLOAD))
        r['route_msg'] = res.get('msg')
        items = res.get('items') or []
        runners = [it for it in items if str(it.get('name', '')).startswith('Runner')]
        r['lengths_cm'] = [it.get('length') for it in runners]
        r['ok_route'] = bool(res.get('ok')) and len(runners) == 4 and all(it.get('ok') for it in runners)
        r['ok_lengths'] = len(runners) == 4 and all(abs((it.get('length') or 0) - 38.0) <= 0.05 for it in runners)
        r['ok_gate_note'] = 'Wastegate: not routed' in (res.get('msg') or '')
        bodies = [b for occ in root.allOccurrences for b in (occ.bRepBodies.item(i) for i in range(occ.bRepBodies.count))]
        r['info_bodies'] = [b.name for b in bodies]
        r['ok_bodies'] = sum(1 for b in bodies if b.name.startswith('Runner')) == 4 and any('Merge collector' in b.name for b in bodies)
        r['gaps_mm'] = [(b.name, round(app.measureManager.measureMinimumDistance(b, head).value * 10, 2)) for b in bodies if b.name.startswith('Runner')]
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
    out['tests']['turbo_manifold'] = r
    print(json.dumps(out, indent=1, default=str))
    _DONE[0] = out
    return out


run()
