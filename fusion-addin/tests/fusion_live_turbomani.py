"""Live check of the turbo manifold mode (act_route mode 'turbomani', turbomani.py) in Fusion, for the first run on the
owner's PC (run it as a Fusion script, or through the Fusion MCP). NOT RUN in the development container (there is no Fusion
there). First live run 2026-11-16 (Fusion 2706.1.17, add-in 4.23.0): ok_route and ok_lengths failed in the x = 50 scene,
which cannot hold 38 cm runners with 7.14 cm bends (docs/STATUS.md); this two-case version has not been run yet.

Makes a throw-away design in centimetres (Fusion's internal unit), the scene of tests/test_turbomani.py: a head face (a box,
x -6..0, y -10..40, z -15..15) with four port markers 9.3 cm apart on it pointing +x, and a turbine flange marker at
(50, 13.95, 0) pointing +x (and then at (58, 13.95, 0)). Through cadtools.dispatch as the panel does: setKeepouts (the head as a mesh body if this Fusion
takes MeshBodies.addByTriangleMeshData, else a solid), then route with the page's payload for a 1.875 in x 0.065 in runner
(fixtures written by web/tests/turbomani_ui.js are not needed here; the payload is written out below), target 38 cm.
Two cases (4.24.0, after the first live run): the flange marker at x = 50 cm, where 38 cm runners do not fit with 7.14 cm
bends (the reply must say so per runner and in one line; the lengths as the container's stand-in gives them), then at
x = 58 cm, where they do. Checks for the second: four runner bodies and one merge collector built, each runner's length
within 0.5 mm of 38 cm (the add-in's items),
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


def _xyz(p):
    return (round(p.x, 4), round(p.y, 4), round(p.z, 4))


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

        def select(ents):
            ui.activeSelections.clear()
            for e in ents:
                ui.activeSelections.add(e)
        select(keep)
        res = ct.dispatch('setKeepouts', '{}')
        r['ok_keepouts'] = bool(res.get('ok'))

        def markers(fx):
            ends = [((0, 9.3 * i, 0), (2, 9.3 * i, 0)) for i in range(4)] + [((fx, 13.95, 0), (fx + 2, 13.95, 0))]
            mk = [L.addByTwoPoints(sk.modelToSketchSpace(P(*a)), sk.modelToSketchSpace(P(*b))) for a, b in ends]
            # how Fusion hands the marker lines back (start/end order, world coordinates): the add-in signs them itself
            r.setdefault('info_markers', []).append([[list(_xyz(m.worldGeometry.startPoint)), list(_xyz(m.worldGeometry.endPoint))] for m in mk])
            return mk

        def runner_info(items):
            # each runner's reason in full: the note, the clearance slacks (cm, negative is short), the shapes' reach
            # and the length stage's tries (4.24.0 items)
            return [{k: it.get(k) for k in ('name', 'ok', 'length', 'note', 'min_gap', 'slack', 'tt_slack', 'length_reach', 'length_tries')}
                    for it in items if str(it.get('name', '')).startswith('Runner')]

        # case 1 (the first live run's scene): the flange marker at x = 50 cm puts the merge plane 26.2 cm from the
        # ports; with 7.14 cm bends no runner that does not loop reaches 38 cm there (4.23.0 built 33.5 / 27.5 cm and
        # said only "needs attention"). Expected now: the same lengths, every runner not ok, its note saying the ends
        # leave no room for that length, and the message's one line "cannot reach the page's 380.0 mm here".
        mk = markers(50.0)
        select(mk[:4])
        res = ct.dispatch('route', json.dumps(PAYLOAD))
        r['ok_too_few_markers'] = (not res.get('ok')) and 'Turbo manifold' in (res.get('msg') or '')
        select(mk)
        res = ct.dispatch('route', json.dumps(PAYLOAD))
        r['short_msg'] = res.get('msg')
        ru = runner_info(res.get('items') or [])
        r['short_runners'] = ru
        r['short_lengths_cm'] = [it.get('length') for it in ru]
        r['ok_short_explained'] = (len(ru) == 4 and all((not it['ok']) and 'leaves no room for that length' in (it.get('note') or '') for it in ru)
                                   and "cannot reach the page's 380.0 mm here" in (res.get('msg') or ''))
        r['ok_short_lengths_as_container'] = len(ru) == 4 and all(abs((a or 0) - b) < 0.05 for a, b in zip(r['short_lengths_cm'], (33.495, 27.547, 27.547, 33.495)))
        r['ok_gate_note'] = 'Wastegate: not routed' in (res.get('msg') or '')
        try:
            for occ in list(root.allOccurrences):
                occ.deleteMe()
            r['info_case1_removed'] = True
        except Exception as e:
            r['info_case1_removed'] = 'could not remove the first case\'s component: %s' % e
        # case 2: the flange marker 8 cm further out (x = 58): the container's stand-in routes all four at 38 cm
        mk = markers(58.0)
        select(mk)
        res = ct.dispatch('route', json.dumps(PAYLOAD))
        r['route_msg'] = res.get('msg')
        ru = runner_info(res.get('items') or [])
        r['runners'] = ru
        r['lengths_cm'] = [it.get('length') for it in ru]
        r['ok_route'] = bool(res.get('ok')) and len(ru) == 4 and all(it.get('ok') for it in ru)
        r['ok_lengths'] = len(ru) == 4 and all(abs((it.get('length') or 0) - 38.0) <= 0.05 for it in ru)
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
