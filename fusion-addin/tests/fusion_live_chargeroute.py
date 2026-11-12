"""Live check of "Charge piping from your scan" in Fusion (run it as a Fusion script, or through the Fusion MCP), for the
first run on the owner's PC. NOT RUN in the development container (there is no Fusion there): every Fusion call below
is the same kind the add-in already makes for its other auto-routes, but this file itself has not been run yet.

Makes a throw-away design with a small obstacle scene in centimetres (Fusion's internal unit):
  - a wall at x 28..32 cm, closed except a 12 x 12 cm window centred 15 cm up (y -6..6, z 9..21), as
    tests/test_chargeroute.py 2.: the compressor-to-intercooler leg has to go through the window;
  - a box under the compressor outlet (x 0..20, y -10..10, z -20..-9) standing for the turbine housing, marked hot.
The wall is added as a mesh body when this Fusion takes MeshBodies.addByTriangleMeshData (info_scan_as says which),
else as solid boxes. Markers: sketch lines at (0,0,0) -> +x (compressor outlet), (60,0,0) -> +x (intercooler inlet),
(60,40,0) -> -x (intercooler outlet), (5,40,10) -> -x (throttle body). Then, through cadtools.dispatch as the panel
does: setKeepouts, setHotKeepouts, chargeRoute (2.5 in OD aluminium, 0.065 in wall, the stocked radii given here),
chargeRouteBuild with each leg's lowest-loss route. Checks: both legs fit, routes ranked by loss, two bodies built,
each tube body's smallest distance to each solid keep-out (Fusion's measureMinimumDistance) at least the clearance
(12.7 mm, 50.8 mm from the hot box) less 0.1 mm, and each pipe's volume close to the outside cylinder less the inside
for its centreline length.
Prints JSON (the failing ok_ keys say what broke), closes the design (set ET_KEEP_DOC=1 to keep it)."""
import importlib.util
import json
import math
import os
import sys
import traceback

import adsk.core
import adsk.fusion

_DONE = []


def _box(lo, hi):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    F = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (3, 6, 2), (3, 7, 6), (0, 4, 7), (0, 7, 3),
         (1, 2, 6), (1, 6, 5)]
    return [c for p in P for c in p], [i for f in F for i in f]


WALL = [((28, -25, -20), (32, 25, 9)), ((28, -25, 21), (32, 25, 40)), ((28, -25, 9), (32, -6, 21)), ((28, 6, 9), (32, 25, 21))]
HOT = ((0, -10, -20), (20, 10, -9))


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
        for mod in ('router', 'templates', 'chargeroute'):
            sys.modules.pop(mod, None)
        spec = importlib.util.spec_from_file_location('cadtools_live_chargeroute', os.path.join(folder, 'cadtools.py'))
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._app, ct._ui = app, ui
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        P = adsk.core.Point3D.create
        tbm = adsk.fusion.TemporaryBRepManager.get()

        def solid(lo, hi, name):
            c = P((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
            obb = adsk.core.OrientedBoundingBox3D.create(c, adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0),
                                                         hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
            return ct._add_bodies(root, [(tbm.createBox(obb), name)])[0]

        # ---- the scan: a mesh body if this Fusion makes one from triangles, else solids
        keep, solids = [], []
        try:
            coords, idx = [], []
            for lo, hi in WALL:
                c, i = _box(lo, hi)
                base = len(coords) // 3
                coords += c
                idx += [base + k for k in i]
            mb = root.meshBodies.addByTriangleMeshData(coords, idx, [], [])
            mb = mb if hasattr(mb, 'displayMesh') else mb.item(0)
            mb.name = 'Scan (wall with a window)'
            keep.append(mb)
            r['info_scan_as'] = 'mesh body'
        except Exception as e:
            r['info_scan_as'] = 'solids (mesh body refused: %s)' % e
            for k, (lo, hi) in enumerate(WALL):
                b = solid(lo, hi, 'Wall %d' % (k + 1))
                keep.append(b)
                solids.append((b, 1.27))
        hot = solid(HOT[0], HOT[1], 'Turbine box')
        keep.append(hot)
        solids.append((hot, 5.08))
        # ---- markers
        sk = root.sketches.add(root.xYConstructionPlane)
        sk.name = 'Charge pipe markers'
        L = sk.sketchCurves.sketchLines
        mk = [L.addByTwoPoints(sk.modelToSketchSpace(P(*a)), sk.modelToSketchSpace(P(*b))) for a, b in
              (((0, 0, 0), (2, 0, 0)), ((60, 0, 0), (62, 0, 0)), ((60, 40, 0), (58, 40, 0)), ((5, 40, 10), (3, 40, 10)))]
        r['info_marker_starts'] = [[round(v, 3) for v in ct._t(m.startSketchPoint.worldGeometry)] for m in mk]

        def select(ents):
            ui.activeSelections.clear()
            for e in ents:
                ui.activeSelections.add(e)
        select(keep)
        res = ct.dispatch('setKeepouts', '{}')
        r['ok_keepouts'] = bool(res.get('ok'))
        select([hot])
        res = ct.dispatch('setHotKeepouts', '{}')
        r['ok_hot'] = bool(res.get('ok')) and res.get('hot') == ['Turbine box']
        stock = [{'clr_mm': 63.5, 'angles': [90]}, {'clr_mm': 95.25, 'angles': [45, 90]}, {'clr_mm': 101.6, 'angles': [90]}]
        flow = {'m_kg_s': 0.25, 'T_C': 120.0, 'p_Pa': 202650.0, 'rho_amb': 1.184}
        data = {'legs': [{'kind': 'hot', 'name': 'Compressor outlet to intercooler inlet', 'id_mm': 60.198, 'wall_mm': 1.651, 'gap_mm': 12.7, 'stock': stock, 'flow': flow},
                         {'kind': 'cold', 'name': 'Intercooler outlet to throttle body', 'id_mm': 60.198, 'wall_mm': 1.651, 'gap_mm': 12.7, 'stock': stock,
                          'flow': dict(flow, T_C=45.0)}],
                'hot_gap_mm': 50.8, 'coupler_mm': 76.2, 'joints': 'weld', 'min_straight_mm': 0, 'time_s': 30, 'max_radii': 3}
        select(mk[:3])
        res = ct.dispatch('chargeRoute', json.dumps(data))
        r['missing_marker_msg'] = res.get('msg')
        r['ok_missing_marker'] = (not res.get('ok')) and 'Missing: the end marker of Intercooler outlet to throttle body' in (res.get('msg') or '')
        select(mk)
        rec = ct.dispatch('chargeRoute', json.dumps(data))
        r['route_msg'] = rec.get('msg')
        legs = (rec.get('plan') or {}).get('legs') or []
        r['ok_route'] = bool(rec.get('ok')) and len(legs) == 2 and all(x['ok'] for x in legs)
        r['candidates'] = [[(c['label'], round(c.get('dp_Pa', 0)), round(c.get('length_mm', 0), 1), c.get('min_gap_mm')) for c in x['candidates']] for x in legs]
        r['ok_ranked'] = all([c['dp_Pa'] for c in x['candidates'] if c['ok']] == sorted(c['dp_Pa'] for c in x['candidates'] if c['ok']) for x in legs)
        n0 = sum(1 for _ in root.allOccurrences)
        bres = ct.dispatch('chargeRouteBuild', json.dumps({'choice': [x['candidates'][x['best']]['id'] if x['best'] is not None else None for x in legs]}))
        r['build_msg'] = bres.get('msg')
        r['ok_build'] = bool(bres.get('ok'))
        tubes = []
        for occ in root.allOccurrences:
            for i in range(occ.bRepBodies.count):
                b = occ.bRepBodies.item(i)
                if b.name in ('Compressor outlet to intercooler inlet', 'Intercooler outlet to throttle body'):
                    tubes.append(b)
        r['info_new_occurrences'] = sum(1 for _ in root.allOccurrences) - n0
        r['ok_two_tubes'] = len(tubes) == 2
        gaps = []
        for t in tubes:
            for b, need in solids:
                d = app.measureManager.measureMinimumDistance(t, b).value
                gaps.append((t.name, b.name, round(d * 10, 2), need * 10))
        r['gaps_mm'] = gaps
        r['ok_gaps'] = bool(gaps) and all(d >= need - 0.1 for _t, _b, d, need in gaps)
        vols = []
        items = {q['name']: q for q in (bres.get('items') or [])}
        for t in tubes:
            if t.name not in items:
                continue
            od, idd, Lc = (60.198 + 2 * 1.651) / 10.0, 60.198 / 10.0, items[t.name]['length']
            want = math.pi / 4 * (od * od - idd * idd) * Lc
            vols.append((t.name, round(t.volume, 2), round(want, 2)))
        r['volumes_cm3'] = vols
        r['ok_volumes'] = bool(vols) and all(abs(v - w) / w < 0.01 for _n, v, w in vols)
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
    out['tests']['charge_route'] = r
    print(json.dumps(out, indent=1, default=str))
    _DONE[0] = out
    return out


run()
