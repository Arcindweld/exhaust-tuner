"""Live check of the chamber builders in Fusion (run it as a Fusion script, or through the Fusion MCP).
Makes a throw-away design and builds, with a fresh copy of the installed add-in's cadtools.py (so a running older
add-in does not matter), from one sketch-line marker each:
  chamber   an inline expansion chamber on a 2.5 in x 0.065 in pipe: 6 in bore, 10 in long, 2 in and 3 in extended
            tubes, no baffles
  baffled   the same chamber with two baffles with a 1.5 in hole
  rev       a reverse-flow flat-oval case 9 x 4.5 in inside, 12 in long, the two tubes run in 4 in, 3.5 in apart
Each is checked in Fusion's own numbers: the bodies made, each revolved body's volume against the section it was
revolved from (Pappus), the gas the add-in reports against the case's inside less what the tubes and baffles fill,
the tubes clear of each other and the baffles clear of the tubes, the rev case's holes cut through the plate.
Prints JSON (ok per test and the numbers behind it), then closes the design without saving."""
import importlib.util
import json
import math
import os
import sys
import traceback

import adsk.core
import adsk.fusion

_DONE = []
IN = 25.4                                    # mm per inch


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
        for mod in ('router', 'templates'):
            sys.modules.pop(mod, None)
        spec = importlib.util.spec_from_file_location('cadtools_live_chambers', os.path.join(folder, 'cadtools.py'))
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._app, ct._ui = app, ui
        TPL = ct.TPL
        out['addin_version'] = getattr(ct, 'VERSION', None)
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        tbm = adsk.fusion.TemporaryBRepManager.get()
        P = lambda x, y, z: adsk.core.Point3D.create(x, y, z)

        def marker(p0, p1, name):
            s = root.sketches.add(root.xZConstructionPlane)
            s.name = name
            ln = s.sketchCurves.sketchLines.addByTwoPoints(s.modelToSketchSpace(P(*p0)), s.modelToSketchSpace(P(*p1)))
            ui.activeSelections.clear()
            ui.activeSelections.add(ln)
            return ln

        def comp_bodies(name):
            for i in range(root.occurrences.count):
                occ = root.occurrences.item(i)
                if occ.component.name == name:
                    c = occ.component
                    return {c.bRepBodies.item(k).name: c.bRepBodies.item(k).createForAssemblyContext(occ) for k in range(c.bRepBodies.count)}
            return {}

        def overlap(a, b):
            ca, cb = tbm.copy(a), tbm.copy(b)
            if not tbm.booleanOperation(ca, cb, adsk.fusion.BooleanTypes.IntersectionBooleanType):
                return 0.0
            return ca.volume

        def test(name, fn):
            try:
                r = fn()
                r['ok'] = all(v for k, v in r.items() if k.startswith('ok_'))
            except Exception:
                r = {'ok': False, 'error': traceback.format_exc()}
            out['tests'][name] = r

        pipe_id, wall = 2.5 * IN - 2 * 0.065 * IN, 0.065 * IN
        base = {'pipe_id_mm': pipe_id, 'wall_mm': wall, 'can_id_mm': 6 * IN, 'can_wall_mm': 0.06 * IN,
                'can_len_mm': 10 * IN, 'in_mm': 2 * IN, 'out_mm': 3 * IN, 'stub_mm': 2 * IN}

        def chamber(title, z, extra):
            data = dict(base, title=title, **extra)
            marker((0.0, 0.0, z), (5.0, 0.0, z), title + ' marker')
            res = ct.act_chamber(data)
            b = comp_bodies(title)
            cm = lambda k, d=0.0: (float(data.get(k, d)) / 10.0)
            lay = TPL.ext_chamber(cm('pipe_id_mm'), cm('wall_mm'), cm('can_id_mm'), cm('can_wall_mm'), cm('can_len_mm'),
                                  cm('in_mm'), cm('out_mm'), cm('stub_mm'), int(data.get('baffles', 0)), cm('baffle_hole_mm'), cm('can_wall_mm'))
            r = {'msg': res.get('msg'), 'bodies': sorted(b)}
            want = {title + ' shell': lay['shell'], title + ' inlet tube': lay['inlet'], title + ' outlet tube': lay['outlet']}
            for i, sec in enumerate(lay['baffles']):
                want['%s baffle %d' % (title, i + 1)] = sec
            r['ok_bodies'] = set(want) <= set(b)
            vols = {}
            for n, sec in want.items():
                got, exp = (b[n].volume if n in b else None), TPL.revolved_volume(sec)
                vols[n] = [got, exp]
                r['ok_vol_' + n.replace(title + ' ', '').replace(' ', '_')] = got is not None and abs(got - exp) < 2e-3 * exp
            r['volumes_cm3'] = vols
            tin, tout = b.get(title + ' inlet tube'), b.get(title + ' outlet tube')
            if tin and tout:
                r['tube_overlap'] = overlap(tin, tout)
                r['ok_tubes_apart'] = r['tube_overlap'] < 1e-4
            for i in range(len(lay['baffles'])):
                bf = b.get('%s baffle %d' % (title, i + 1))
                if bf:
                    for t in (tin, tout):
                        if t:
                            r['ok_baffle%d_clear_of_%s' % (i + 1, t.name.split()[-2])] = overlap(bf, t) < 1e-4
                    sh = b.get(title + ' shell')
                    if sh:
                        r['ok_baffle%d_fits_the_bore' % (i + 1)] = overlap(bf, sh) < 1e-4
            # the gas (the cavity round the tubes): the shell's bore, less what the extended tubes take of it over their
            # outside, less each baffle's share of the bore (measured in Fusion: the baffle body against a bore cylinder)
            Rc, Lc = cm('can_id_mm') / 2.0, cm('can_len_mm')
            inside = math.pi * Rc * Rc * Lc
            od = cm('pipe_id_mm') + 2 * cm('wall_mm')
            fill = math.pi / 4 * od ** 2 * (cm('in_mm') + cm('out_mm'))
            for i in range(len(lay['baffles'])):
                bf = b.get('%s baffle %d' % (title, i + 1))
                if bf:
                    bore = tbm.createCylinderOrCone(adsk.core.Point3D.create(cm('can_wall_mm'), 0, z), Rc,
                                                    adsk.core.Point3D.create(cm('can_wall_mm') + Lc, 0, z), Rc)
                    fill += overlap(bf, bore)
            rep = res['items'][0]['chamber']['gas_cm3']
            r['gas_reported'], r['gas_check'] = rep, inside - fill
            r['ok_gas'] = abs(rep - (inside - fill)) < 1e-4 * inside
            r['ok_reported'] = bool(res.get('ok'))
            return r

        test('chamber', lambda: chamber('Chamber A', 0.0, {}))
        test('baffled', lambda: chamber('Chamber B', 40.0, {'baffles': 2, 'baffle_hole_mm': 1.5 * IN}))

        def t_rev():
            title = 'Reverse case'
            data = dict(base, title=title, case_w_mm=9 * IN, case_h_mm=4.5 * IN, can_len_mm=12 * IN, in_mm=4 * IN,
                        spacing_mm=3.5 * IN)
            marker((0.0, 0.0, 80.0), (5.0, 0.0, 80.0), title + ' marker')
            res = ct.act_revchamber(data)
            b = comp_bodies(title)
            r = {'msg': res.get('msg'), 'bodies': sorted(b)}
            case, tin, tout = b.get(title + ' case'), b.get(title + ' inlet tube'), b.get(title + ' outlet tube')
            r['ok_bodies'] = bool(case and tin and tout)
            W, H, cw, L = 9 * 2.54, 4.5 * 2.54, 0.06 * 2.54, 12 * 2.54
            od, pid = 2.5 * 2.54, pipe_id / 10.0
            area = lambda w, h: math.pi * h * h / 4.0 + (w - h) * h
            hole_r = od / 2.0 + 0.025
            shell = area(W + 2 * cw, H + 2 * cw) * (L + 2 * cw) - area(W, H) * L - 2 * math.pi * hole_r ** 2 * cw
            if case:
                r['case_volume'], r['case_volume_want'] = case.volume, shell
                r['ok_case_volume'] = abs(case.volume - shell) < 2e-3 * shell
            tube = math.pi / 4 * (od ** 2 - pid ** 2) * (2 * 2.54 + cw + 4 * 2.54)
            for t in (tin, tout):
                if t:
                    r['ok_vol_' + t.name.split()[-2]] = abs(t.volume - tube) < 2e-3 * tube
                    r[t.name.split()[-2] + '_volume'] = [t.volume, tube]
                    if case:
                        r['ok_%s_through_plate' % t.name.split()[-2]] = overlap(t, case) < 1e-3
            if tin and tout:
                r['ok_tubes_apart'] = overlap(tin, tout) < 1e-4
            gas = area(W, H) * L - 2 * math.pi * (od / 2.0) ** 2 * 4 * 2.54
            r['gas_reported'], r['gas_check'] = res['items'][0]['chamber']['gas_cm3'], gas
            r['ok_gas'] = abs(r['gas_reported'] - gas) < 1e-6 * gas
            r['ok_reported'] = bool(res.get('ok'))
            return r

        test('rev', t_rev)
        try:
            app.activeViewport.fit()
            out['screenshot'] = None
        except Exception:
            pass
        out['ok'] = all(t.get('ok') for t in out['tests'].values())
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
