"""Live check of the Mounts designer's Fusion actions (mountPlace, mountPick, mountBuild), for the first run on the
owner's PC. NOT RUN in the development container (there is no Fusion there): tests/test_mounts_fusion_fake.py runs the
same glue against a stand-in for Fusion's API, and the plates are built by _hang_plate, the function the hanger build
already uses, but this file itself has not been run yet.

Run it as a Fusion script (or through the Fusion MCP). It makes a throw-away design in centimetres (Fusion's unit):
  - a floor slab (x -40..40, y -40..40, z -2..0) with two small pads on it (2 x 2 mm tops at (-28, -5, 0) and
    (28, -5, 0)): a face picked in code has no click point, so the pad's face stands for the click;
  - a box standing for the turbo (x 34..36, y -8..-2, z 3..8), marked hot;
  - the part: mountPlace's stand-in, 600 x 300 x 100 mm, centred at (0, 0, 25) (Z up);
  - mount points: sketch points on the part's front face at (-28, -5, 12) and (28, -5, 12).
Then, through cadtools.dispatch as the panel does: setKeepouts (floor, pads, turbo), setHotKeepouts (turbo), mountPick,
mountBuild with two 1/8 in mild-steel straps 54 mm wide (the payload test_mounts_fusion_fake.py sends). Checks: the
stand-in's size, each reach 120 mm (within 1 mm: the pad's face point), four plate bodies, each upright's volume against
its outline area x thickness (within 1%), Fusion's measured distance from each bracket body to the turbo box against the
add-in's reported hot gap (within 1.5 mm: the add-in samples points), mount 2 flagged inside the 50.8 mm hot clearance
and mount 1 not.
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
        for mod in ('router', 'templates', 'hangers', 'mounts'):
            sys.modules.pop(mod, None)
        spec = importlib.util.spec_from_file_location('cadtools_live_mounts', os.path.join(folder, 'cadtools.py'))
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._app, ct._ui = app, ui
        MNT = ct.MNT
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        P = adsk.core.Point3D.create
        tbm = adsk.fusion.TemporaryBRepManager.get()
        r['info_z_up'] = ct._z_up()

        def solid(lo, hi, name):
            c = P((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
            obb = adsk.core.OrientedBoundingBox3D.create(c, adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0),
                                                         hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
            return ct._add_bodies(root, [(tbm.createBox(obb), name)])[0]

        def top_face(body):
            return max((body.faces.item(i) for i in range(body.faces.count)), key=lambda f: f.pointOnFace.z)

        def select(ents):
            ui.activeSelections.clear()
            for e in ents:
                ui.activeSelections.add(e)
        floor = solid((-40, -40, -2), (40, 40, -0.5), 'Floor')
        pads = [solid((x - 0.1, -5.1, -0.5), (x + 0.1, -4.9, 0.0), 'Pad %d' % (k + 1)) for k, x in enumerate((-28, 28))]
        turbo = solid((34, -8, 3), (36, -2, 8), 'Turbo box')
        select([floor, turbo] + pads)
        r['ok_keepouts'] = bool(ct.dispatch('setKeepouts', '{}').get('ok'))
        select([turbo])
        r['ok_hot'] = bool(ct.dispatch('setHotKeepouts', '{}').get('ok'))
        # the stand-in at a sketch point (0, 0, 25)
        sk = root.sketches.add(root.xYConstructionPlane)
        sk.name = 'Mount points'
        sp = lambda q: sk.sketchPoints.add(sk.modelToSketchSpace(P(*q)))
        c0 = sp((0, 0, 25))
        select([c0])
        res = ct.dispatch('mountPlace', json.dumps({'shape': 'box', 'L_mm': 600, 'H_mm': 300, 'W_mm': 100, 'name': 'Core stand-in'}))
        r['place_msg'] = res.get('msg')
        part = None
        for occ in root.allOccurrences:
            for i in range(occ.bRepBodies.count):
                if occ.bRepBodies.item(i).name == 'Core stand-in':
                    part = occ.bRepBodies.item(i)
        bb = part.boundingBox if part else None
        r['part_box'] = None if bb is None else [[round(bb.minPoint.x, 3), round(bb.minPoint.y, 3), round(bb.minPoint.z, 3)], [round(bb.maxPoint.x, 3), round(bb.maxPoint.y, 3), round(bb.maxPoint.z, 3)]]
        r['ok_place'] = bool(res.get('ok')) and bb is not None and abs(bb.maxPoint.x - bb.minPoint.x - 60) < 1e-3 and abs(bb.maxPoint.z - bb.minPoint.z - 30) < 1e-3 \
            and abs(bb.maxPoint.y - bb.minPoint.y - 10) < 1e-3
        m1, m2 = sp((-28, -5, 12)), sp((28, -5, 12))
        select([part, m1, top_face(pads[0]), m2, top_face(pads[1])])
        pk = ct.dispatch('mountPick', '{}')
        r['pick_msg'] = pk.get('msg')
        ms = pk.get('mounts') or []
        r['ok_pick'] = bool(pk.get('ok')) and len(ms) == 2 and all(abs(m['h_mm'] - 120) < 1.0 and m['dir'] == 'dn' for m in ms)
        br = {'type': 'strap', 't': 3.175, 'b': 54.0, 'hole': 9.0, 'bolt': 8.0, 'R': 3.175, 'K': 0.42, 's': 0.0, 'u': [1, 0, 0],
              'foot': {'nb': 2, 'sb': 27.0, 'hole': 9.0, 'bolt': 8.0, 'a': 13.7, 'L': 27.2}, 'light': [], 'hf': 0, 'hg': 0}
        data = {'brackets': [dict(br, name='Mount %d' % (k + 1), h=ms[k]['h_mm'] if k < len(ms) else 120.0) for k in range(2)],
                'gap_mm': 12.7, 'hot_gap_mm': 50.8, 'socket_r_mm': 12.7, 'tool_mm': 150}
        bres = ct.dispatch('mountBuild', json.dumps(data))
        r['build_msg'] = bres.get('msg')
        reps = bres.get('brackets') or []
        bodies = {}
        for occ in root.allOccurrences:
            for i in range(occ.bRepBodies.count):
                b = occ.bRepBodies.item(i)
                if b.name.startswith('Mount '):
                    bodies[b.name] = b
        r['bodies'] = sorted(bodies)
        r['ok_bodies'] = bool(bres.get('ok')) and len(bodies) == 4
        # the upright's volume: its outline (tab_outline, the arc by fine steps) less the hole, times the thickness
        vol = []
        for k in range(2):
            b = bodies.get('Mount %d upright' % (k + 1))
            if b is None:
                continue
            h = ms[k]['h_mm']
            seg = MNT.tab_outline(54.0, 0.0, 0.0, h, 27.0)
            pts = []
            for s in seg:
                if s['t'] == 'L':
                    pts.append(tuple(s['a']))
                else:
                    sw = (s['a1'] - s['a0']) % (2 * math.pi)
                    pts += [(s['c'][0] + s['r'] * math.cos(s['a0'] + sw * j / 400), s['c'][1] + s['r'] * math.sin(s['a0'] + sw * j / 400)) for j in range(400)]
            area = abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2 - math.pi * 4.5 ** 2
            want = area * 3.175 / 1000.0
            vol.append((b.name, round(b.volume, 3), round(want, 3)))
        r['upright_volumes_cm3'] = vol
        r['ok_volumes'] = len(vol) == 2 and all(abs(v - w) / w < 0.01 for _n, v, w in vol)
        gaps = []
        for k in range(2):
            d = min(app.measureManager.measureMinimumDistance(bodies[n], turbo).value for n in bodies if n.startswith('Mount %d ' % (k + 1)))
            gaps.append((k + 1, round(10 * d, 2), reps[k]['hot_gap_mm'] if k < len(reps) else None))
        r['hot_gaps_mm_fusion_vs_addin'] = gaps
        r['ok_hot_gap'] = len(gaps) == 2 and all(a is not None and abs(f - a) < 1.5 for _k, f, a in gaps)
        r['ok_flags'] = len(reps) == 2 and reps[0]['clear'] and not reps[1]['clear']
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
    out['tests']['mounts'] = r
    print(json.dumps(out, indent=1, default=str))
    _DONE[0] = out
    return out


run()
