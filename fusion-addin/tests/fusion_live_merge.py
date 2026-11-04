"""Live check of the merge collector and Y merge in Fusion (run it as a Fusion script, or through the Fusion MCP).
In a throw-away design it builds, from the installed add-in's own cadtools.py: a 4-into-1 merge (1-5/8 in tubes into
3 in, with its spike) and a 2-into-1 Y merge, each as features (_merge_param, through _merge_collector), and the
4-into-1 again as a fixed body (_merge_body); then checks each is one solid in one piece with the volume merge.plan
works out by hand, and prints what it found. The design is closed without saving."""
import importlib.util
import json
import math
import os
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
    out = {'cases': []}
    doc = None
    try:
        addin = os.path.join(os.environ["APPDATA"], "Autodesk", "Autodesk Fusion 360", "API", "AddIns", "ExhaustTuner")
        import sys
        if addin not in sys.path:
            sys.path.insert(0, addin)
        spec = importlib.util.spec_from_file_location("cadtools_live_merge", os.path.join(addin, "cadtools.py"))
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._ui = ui
        ct._app = app              # what the add-in sets when it starts; _add_bodies reads the design from it
        RT, MRG = ct.RT, ct.MRG
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        IN = 2.54
        for name, n, od_in, out_in, L_in, start, axis in (
                ('Merge collector', 4, 1.625, 3.0, 4.0, (20.0, 5.0, -10.0), RT.vunit((0.2, -0.3, -1.0))),
                ('Y merge 1', 2, 1.625, 2.0, 2.4, (-15.0, 8.0, 4.0), RT.vunit((1.0, 0.1, -0.4)))):
            od, wall = od_in * IN, 0.065 * IN
            slots = RT.collector_slots(start, axis, n, od, 10.0)
            col = RT.collector_body(start, axis, n, od, L_in * IN, out_in * IN, None, 1.0)
            notes = []
            occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
            comp = occ.component
            comp.name = name
            b = ct._merge_collector(comp, col, slots, od, wall, name, notes, 2.54)
            p = b.get('merge')
            bodies = [comp.bRepBodies.item(i) for i in range(comp.bRepBodies.count) if comp.bRepBodies.item(i).isSolid]
            vis = [x for x in bodies if x.isVisible]
            body = max(bodies, key=lambda x: x.volume) if bodies else None
            r = {'name': name, 'param': b.get('param'), 'bodies': len(bodies), 'body_names': [x.name for x in bodies],
                 'lumps': body.lumps.count if body else 0, 'volume_cm3': body.volume if body else None,
                 'plan_cm3': p['volume_cm3'] if p else None, 'notes': notes}
            r['vol_err'] = abs(r['volume_cm3'] / r['plan_cm3'] - 1.0) if body and p else None
            r['ok'] = bool(b.get('param') and len(bodies) == 1 and r['lumps'] == 1 and r['vol_err'] is not None and r['vol_err'] < 0.005)
            out['cases'].append(r)
            if n == 4:
                # the same merge as a fixed body (the fallback when the features are refused)
                occ2 = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
                c2 = occ2.component
                c2.name = name + ' fixed'
                fb = ct._add_bodies(c2, [(ct._merge_body(p), name + ' (fixed)')])[0]
                rf = {'name': name + ' (fixed body)', 'lumps': fb.lumps.count, 'volume_cm3': fb.volume, 'plan_cm3': p['volume_cm3']}
                rf['vol_err'] = abs(fb.volume / p['volume_cm3'] - 1.0)
                rf['ok'] = fb.lumps.count == 1 and rf['vol_err'] < 0.005
                out['cases'].append(rf)
        out['ok'] = all(c['ok'] for c in out['cases'])
    except Exception:
        out['error'] = traceback.format_exc()
        out['ok'] = False
    finally:
        if doc is not None:
            try:
                doc.close(False)
            except Exception:
                pass
    txt = json.dumps(out, indent=1)
    print(txt)
    _DONE[0] = txt
    return txt
