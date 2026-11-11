"""Live check of "Test this intake (CFD)" in Fusion (run it as a Fusion script, or through the Fusion MCP), for the first
run on the owner's PC. Makes a throw-away design with the owner's reference CAI tube (92.61 mm / 3.646 in bore, 4.76 mm /
0.187 in wall; a 100 mm / 3.94 in straight, 29.5 degrees on 127 mm / 5 in, 406.7 mm / 16.01 in straight, 84.1 degrees
on 127 mm, 122.1 mm / 4.81 in straight: 880.6 mm / 34.67 in), made with the add-in's own Pipe helper:
  1. laid flat (both bends in one sketch on XY): selects the mouth's end face, runs cadtools.act_cfd_tube with the
     mouth on 'auto' and on 'other' and checks, in Fusion's own numbers, the bore, wall, length, both bends' angles,
     radii and starts from either end, and what Selection.point gave for a selection made by the script (a click in the
     canvas gives the click point; a script's selection may not: info_ keys, not counted);
  2. in 3-D (the second bend on a construction plane at an angle through the middle straight, clocked 139.25 degrees
     round the tube from the first as on the owner's tube; one Pipe along curves of two sketches): bend 2's plane_deg;
  3. the Exhaust Tuner program: found (foamrun.status), its host started from Fusion's Python and answering hostInfo
     with its OpenFOAM;
  4. with ET_RUN_CFD=1 only: the 3-D tube's CFD on the coarse mesh through foamrun.run_openfoam (design.json only, the
     program generates the case), about 5-15 minutes on one core with Fusion busy: the drop at the tract end, K, cells.
Prints JSON (the failing ok_ keys say what broke), closes the design (set ET_KEEP_DOC=1 to keep it)."""
import importlib.util
import json
import math
import os
import sys
import threading
import traceback

import adsk.core
import adsk.fusion

_DONE = []
OWNER = dict(L1=100.0, A1=29.501, L2=406.69, A2=84.103, L3=122.10, R=127.0, bore=92.61, wall=4.76, phi=139.246)


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
        for mod in ('router', 'templates', 'printsplit', 'tubecfd', 'foamrun', 'hostrun'):
            sys.modules.pop(mod, None)
        spec = importlib.util.spec_from_file_location('cadtools_live_intakecfd', os.path.join(folder, 'cadtools.py'))
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._app, ct._ui = app, ui
        import foamrun as FR
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        P = adsk.core.Point3D.create
        o = OWNER
        R, od, wall = o['R'] / 10.0, (o['bore'] + 2 * o['wall']) / 10.0, o['wall'] / 10.0
        a1, a2 = math.radians(o['A1']), math.radians(o['A2'])

        # ---------------------------------------------------------------- 1. the tube laid flat
        sk = root.sketches.add(root.xYConstructionPlane)
        sk.name = 'cai flat'
        lines, arcs = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs
        L1, L2, L3 = o['L1'] / 10.0, o['L2'] / 10.0, o['L3'] / 10.0
        l1 = lines.addByTwoPoints(P(0, 0, 0), P(L1, 0, 0))
        c1 = arcs.addByCenterStartSweep(P(L1, R, 0), l1.endSketchPoint, a1)
        e1 = c1.endSketchPoint.geometry
        d1 = (math.cos(a1), math.sin(a1))
        l2 = lines.addByTwoPoints(c1.endSketchPoint, P(e1.x + L2 * d1[0], e1.y + L2 * d1[1], 0))
        e2 = l2.endSketchPoint.geometry
        c2 = arcs.addByCenterStartSweep(P(e2.x - R * d1[1], e2.y + R * d1[0], 0), l2.endSketchPoint, a2)
        d2 = (math.cos(a1 + a2), math.sin(a1 + a2))
        e3 = c2.endSketchPoint.geometry
        lines.addByTwoPoints(c2.endSketchPoint, P(e3.x + L3 * d2[0], e3.y + L3 * d2[1], 0))
        path = adsk.fusion.Path.create(l1, adsk.fusion.ChainedCurveOptions.connectedChainedCurves)
        body = ct._pipe(root, path, od, wall).bodies.item(0)
        body.name = 'CAI FLAT'
        mouth_face = None
        for i in range(body.faces.count):
            f = body.faces.item(i)
            if f.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType:
                q = f.pointOnFace
                if math.sqrt(q.x ** 2 + q.y ** 2 + q.z ** 2) < od / 2 + 0.1:
                    mouth_face = f
        r['mouth_face_found'] = mouth_face is not None
        ui.activeSelections.clear()
        ui.activeSelections.add(mouth_face)
        try:
            sp = ui.activeSelections.item(0).point
            r['info_selection_point_cm'] = [round(sp.x, 3), round(sp.y, 3), round(sp.z, 3)] if sp else None
        except Exception as e:
            r['info_selection_point_cm'] = 'error: %s' % e
        res_a = ct.dispatch('cfdTube', json.dumps({'mouth': 'auto'}))
        res_o = ct.dispatch('cfdTube', json.dumps({'mouth': 'other'}))
        r['flat_auto_msg'], r['flat_other_msg'] = res_a.get('msg'), res_o.get('msg')
        ta, to = res_a.get('tube') or {}, res_o.get('tube') or {}

        def bends(t):
            return [(b['angle_deg'], b['clr_mm'], b['start_mm']) for b in (t.get('geometry') or {}).get('bend', [])]
        r['flat_auto_bends'], r['flat_other_bends'] = bends(ta), bends(to)
        fwd = [b for b in (bends(ta), bends(to)) if len(b) == 2 and abs(b[0][0] - o['A1']) < 0.1]
        rev = [b for b in (bends(ta), bends(to)) if len(b) == 2 and abs(b[0][0] - o['A2']) < 0.1]
        r['ok_flat_read'] = bool(res_a.get('ok') and res_o.get('ok'))
        r['ok_flat_bore_wall'] = abs(ta.get('bore_mm', 0) - o['bore']) < 0.02 and abs(ta.get('wall_mm', 0) - o['wall']) < 0.02
        Ltot = o['L1'] + o['L2'] + o['L3'] + o['R'] * (a1 + a2)
        r['flat_length_mm'] = ta.get('length_mm')
        r['ok_flat_length'] = abs((ta.get('length_mm') or 0) - Ltot) < 0.2
        r['ok_flat_both_ends'] = bool(fwd and rev)
        if fwd:
            b = fwd[0]
            r['ok_flat_bends'] = (abs(b[0][1] - 127) < 0.05 and abs(b[1][1] - 127) < 0.05 and abs(b[1][0] - o['A2']) < 0.1
                                  and abs(b[0][2] - o['L1']) < 0.3 and abs(b[1][2] - (o['L1'] + o['R'] * a1 + o['L2'])) < 0.3)
        else:
            r['ok_flat_bends'] = False
        r['info_auto_mouth_at_the_clicked_face'] = bool(fwd) and bends(ta) == fwd[0]
        r['ok_flat_plain_mouth'] = (ta.get('geometry') or {}).get('inlet') == {'type': 'plain', 'wall_thickness_mm': round(ta.get('wall_mm', 0), 3)}

        # ---------------------------------------------------------------- 2. the tube in 3-D
        try:
            sk1 = root.sketches.add(root.xYConstructionPlane)
            sk1.name = 'cai 3d a'
            ln, ar = sk1.sketchCurves.sketchLines, sk1.sketchCurves.sketchArcs
            m1 = ln.addByTwoPoints(P(0, 0, 0), P(L1, 0, 0))
            m2 = ar.addByCenterStartSweep(P(L1, R, 0), m1.endSketchPoint, a1)
            s1 = m2.endSketchPoint.geometry
            A2 = (s1.x + L2 * d1[0], s1.y + L2 * d1[1], 0.0)
            m3 = ln.addByTwoPoints(m2.endSketchPoint, P(*A2))
            # the carried frame after bend 1: n1 = bend 1's direction turned with the tube = (-sin a1, cos a1, 0); n2 = z
            phi = math.radians(o['phi'])
            k2 = (-math.sin(a1) * math.cos(phi), math.cos(a1) * math.cos(phi), math.sin(phi))
            # bend 2 leaves the sketch plane: drawn in the same sketch as a 3-D arc through three points (the first live
            # run found a construction plane at an angle through a sketch line is not accepted as a sketch plane)
            C2 = tuple(A2[i] + o['R'] / 10.0 * k2[i] for i in range(3))
            n2v = (d1[1] * k2[2] - 0 * k2[1], 0 * k2[0] - d1[0] * k2[2], d1[0] * k2[1] - d1[1] * k2[0])     # t x k
            rel = tuple(A2[i] - C2[i] for i in range(3))

            def turned(a):
                return tuple(C2[i] + rel[i] * math.cos(a) + (n2v[(i + 1) % 3] * rel[(i + 2) % 3] - n2v[(i + 2) % 3] * rel[(i + 1) % 3]) * math.sin(a) for i in range(3))
            want_end = turned(a2)
            r['ok_3d_plane'] = True
            m5 = ar.addByThreePoints(m3.endSketchPoint, P(*turned(a2 / 2.0)), P(*want_end))
            e5 = m5.endSketchPoint if math.dist(m5.endSketchPoint.geometry.asArray(), want_end) < 1e-4 else m5.startSketchPoint
            r['ok_3d_arc'] = math.dist(e5.geometry.asArray(), want_end) < 1e-4
            t3 = tuple(math.cos(a2) * (d1[0], d1[1], 0)[i] + math.sin(a2) * k2[i] for i in range(3))
            m6 = ln.addByTwoPoints(e5, P(*[want_end[i] + L3 * t3[i] for i in range(3)]))
            m4 = None
            col = adsk.core.ObjectCollection.create()
            for c in (m1, m2, m3, m5, m6):
                col.add(c)
            path3 = adsk.fusion.Path.create(col, adsk.fusion.ChainedCurveOptions.noChainedCurves)
            body3 = ct._pipe(root, path3, od, wall).bodies.item(0)
            body3.name = 'CAI 3D'
            body.isVisible = False
            face3 = None
            for i in range(body3.faces.count):
                f = body3.faces.item(i)
                if f.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType:
                    q = f.pointOnFace
                    if math.sqrt(q.x ** 2 + q.y ** 2 + q.z ** 2) < od / 2 + 0.1:
                        face3 = f
            ui.activeSelections.clear()
            ui.activeSelections.add(face3)
            got = []
            for mouth in ('auto', 'other'):
                rr = ct.dispatch('cfdTube', json.dumps({'mouth': mouth}))
                t = rr.get('tube') or {}
                bl = (t.get('geometry') or {}).get('bend', [])
                got.append((rr.get('ok'), bl, t))
                r['3d_%s_msg' % mouth] = rr.get('msg')
            fwd3 = [g for g in got if g[0] and len(g[1]) == 2 and abs(g[1][0]['angle_deg'] - o['A1']) < 0.1]
            r['3d_bends'] = fwd3[0][1] if fwd3 else [g[1] for g in got]
            r['ok_3d_read'] = bool(fwd3)
            if fwd3:
                b2 = fwd3[0][1][1]
                r['ok_3d_bend2'] = abs(b2['angle_deg'] - o['A2']) < 0.1 and abs(b2['start_mm'] - (o['L1'] + o['R'] * a1 + o['L2'])) < 0.3
                r['ok_3d_plane_deg'] = abs(((b2['plane_deg'] - o['phi'] + 180) % 360) - 180) < 0.2
                tube3 = fwd3[0][2]
            else:
                tube3 = None
        except Exception:
            r['error_3d'] = traceback.format_exc()
            r['ok_3d_read'] = False
            tube3 = None

        # ---------------------------------------------------------------- 3. the program
        host, why = FR.status()
        r['program'] = host or why
        r['ok_program_found'] = bool(host)
        if host:
            try:
                info = FR.ask_host(host)
                r['program_version'] = info.get('version')
                r['program_engines'] = info.get('engines')
                r['ok_program_answers'] = True
                r['ok_program_openfoam'] = bool((info.get('engines') or {}).get('openfoam'))
            except Exception as e:
                r['program_error'] = str(e)
                r['ok_program_answers'] = False

        # ---------------------------------------------------------------- 4. the CFD itself (ET_RUN_CFD=1)
        if os.environ.get('ET_RUN_CFD') == '1' and host and tube3:
            design = {'name': 'live_intakecfd', 'geometry': tube3['geometry'],
                      'operating_point': {'engine': {'displacement_cc': 6162.0, 'rpm': 6600, 've': 0.92, 'strokes': 4, 'cylinders': 8, 'cylinders_fed': 8}},
                      'ambient': {'p_pa': 101325, 'T_c': 25.0}, 'mesh': {'level': 'coarse'}}
            evs = []
            job = {'cancel': threading.Event(), 'procs': [], 'result': None}
            res = FR.run_openfoam({'name': design['name'], 'files': [{'name': 'design.json', 'text': json.dumps(design, indent=1)}]}, job, evs.append, host=host)
            te = ((res.get('results') or {}).get('planes') or {}).get('tract_end') or {}
            r['cfd'] = {'ok': res.get('ok'), 'dp_total_Pa': te.get('dp_total_Pa'), 'K': te.get('K_total_loss'), 'cells': res.get('cells'),
                        'iterations': res.get('iterations'), 'seconds': res.get('seconds_total'), 'case': res.get('case'),
                        'steps': [e.get('step') for e in evs if e.get('event') == 'step'], 'msg': res.get('msg')}
            r['ok_cfd'] = bool(res.get('ok')) and 300 < (te.get('dp_total_Pa') or 0) < 3000 and (res.get('cells') or 0) > 1000
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
    out['tests']['intake_cfd'] = r
    print(json.dumps(out, indent=1, default=str))
    _DONE[0] = out
    return out


run()
