"""Live check of the CFD STL export in Fusion (run it as a Fusion script, or through the Fusion MCP).
Makes a throw-away design with a 50 mm x 300 mm gas-space cylinder inside a component that is moved off the origin,
selects its two caps as inlet and outlet, runs the add-in's own act_export_cfd_stl() from the installed add-in
folder (a fresh copy of cadtools.py, so a running older add-in does not matter), reads the STL back and prints what
it found, then closes the design without saving."""
import importlib.util
import json
import os
import tempfile
import traceback

import adsk.core
import adsk.fusion


_DONE = []


def run(_context=None):
    if _DONE:                     # Fusion calls run(context) after importing the script; run it once
        return _DONE[0]
    _DONE.append(None)
    app = adsk.core.Application.get()
    ui = app.userInterface
    out = {}
    doc = None
    try:
        addin = os.path.join(os.environ["APPDATA"], "Autodesk", "Autodesk Fusion 360", "API", "AddIns", "ExhaustTuner", "cadtools.py")
        spec = importlib.util.spec_from_file_location("cadtools_live_test", addin)
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._ui = ui
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        m = adsk.core.Matrix3D.create()
        m.translation = adsk.core.Vector3D.create(10.0, 5.0, 3.0)          # cm: the body sits off the origin
        occ = root.occurrences.addNewComponent(m)
        comp = occ.component
        sk = comp.sketches.add(comp.yZConstructionPlane)
        sk.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), 2.5)
        ext = comp.features.extrudeFeatures.addSimple(sk.profiles.item(0), adsk.core.ValueInput.createByReal(30.0),
                                                      adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        body = ext.bodies.item(0).createForAssemblyContext(occ)
        planar = [body.faces.item(i) for i in range(body.faces.count)
                  if body.faces.item(i).geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType]
        planar.sort(key=lambda f: f.pointOnFace.x)                         # world x: the first cap is the inlet
        ui.activeSelections.clear()
        for f in planar:
            ui.activeSelections.add(f)
        path = os.path.join(tempfile.gettempdir(), "et_cfd_stl_live.stl")
        res = ct.act_export_cfd_stl({"roles": ["inlet", "outlet"]}, path=path)
        out["export"] = res
        solids, xs = {}, []
        cur = None
        for line in open(path):
            w = line.split()
            if not w:
                continue
            if w[0] == "solid":
                cur = w[1]; solids[cur] = 0
            elif w[0] == "facet":
                solids[cur] += 1
            elif w[0] == "vertex":
                xs.append(float(w[1]))
        out["solids"] = solids
        out["x_range_mm"] = [min(xs), max(xs)]
        out["expect_x_mm"] = [100.0, 400.0]
        out["ok"] = bool(res.get("ok")) and set(solids) == {"inlet", "outlet", "wall"} and abs(min(xs) - 100) < 0.5 and abs(max(xs) - 400) < 0.5
    except Exception:
        out["error"] = traceback.format_exc()
    finally:
        if doc is not None:
            try:
                doc.close(False)
            except Exception:
                pass
    print(json.dumps(out, indent=1))
    _DONE[0] = out
    return out


run()
