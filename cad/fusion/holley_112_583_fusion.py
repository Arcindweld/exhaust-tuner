"""Fusion script: rough Holley EFI 112-583 billet 105 mm LS throttle body as a parametric component.
Same numbers and sources as cad/parts/holley_112_583.py; every size is a user parameter (tb_*), so measured values
replace the [est] ones in Modify > Change Parameters.

Frame: X along the air flow (X = 0 at the flange face that bolts to the intake, +X upstream toward the filter),
Y to the driver's side, Z up.
"""
import adsk.core, adsk.fusion

PARAMS = [  # name, expression, comment (source)
    ("tb_bore", "105 mm", "Holley: 105 mm straight bore"),
    ("tb_inlet_od", "4.375 in", "Holley instructions 510-112-581: inlet OD 4 3/8 in on 112-583"),
    ("tb_bolt_d", "6.6 mm", "clearance for the M6x1 screws Holley supplies"),
    ("tb_flange_w", "5 in", "ICT Billet spacer for the 4-bolt LS flange: 5 x 5 in"),
    ("tb_flange_h", "5 in", "ICT Billet spacer: 5 x 5 in"),
    ("tb_flange_t", "16 mm", "est: flange thickness at the bolts - measure"),
    ("tb_bolt_sq", "4.2 in", "est: bolt square centre to centre - measure"),
    ("tb_body_len", "60 mm", "est: flange face to the start of the inlet spigot - measure"),
    ("tb_body_w", "4.9 in", "est: body width - measure"),
    ("tb_body_h", "4.7 in", "est: body height - measure"),
    ("tb_spigot_len", "25 mm", "est: coupler spigot length - measure"),
    ("tb_shaft_x", "36 mm", "est: throttle shaft from the flange face - measure"),
    ("tb_tps_d", "55 mm", "est: TPS and clocker ring"),
    ("tb_tps_len", "28 mm", "est"),
    ("tb_wheel_d", "64 mm", "est: cable wheel with springs"),
    ("tb_wheel_t", "14 mm", "est"),
    ("tb_iac_w", "45 mm", "est: IAC motor block"),
    ("tb_iac_h", "40 mm", "est"),
    ("tb_iac_len", "38 mm", "est"),
]


def run(ctx=None):
    app = adsk.core.Application.get()
    des = adsk.fusion.Design.cast(app.activeProduct)
    um = des.unitsManager
    up = des.userParameters
    for n, e, c in PARAMS:
        p = up.itemByName(n)
        if p is None:
            up.add(n, adsk.core.ValueInput.createByString(e), "mm", c)
    v = lambda n: up.itemByName(n).value          # cm
    # a Fusion "Part Design" document holds one component: build in the root there, in a new component otherwise
    try:
        comp = des.rootComponent.occurrences.addNewComponent(adsk.core.Matrix3D.create()).component
        comp.name = "Holley 112-583 105mm throttle body (rough)"
    except RuntimeError:
        comp = des.rootComponent
    P3 = adsk.core.Point3D.create
    VI = adsk.core.ValueInput.createByString
    NEW = adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    JOIN = adsk.fusion.FeatureOperations.JoinFeatureOperation
    CUT = adsk.fusion.FeatureOperations.CutFeatureOperation
    planes, sketches, ext = comp.constructionPlanes, comp.sketches, comp.features.extrudeFeatures
    notes = []

    def offset_plane(base, expr, name):
        pi = planes.createInput()
        pi.setByOffset(base, VI(expr))
        pl = planes.add(pi)
        pl.name = name
        pl.isLightBulbOn = False
        return pl

    def dim(sk, a, b, expr, horizontal):
        try:
            o = adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation if horizontal else adsk.fusion.DimensionOrientations.VerticalDimensionOrientation
            d = sk.sketchDimensions.addDistanceDimension(a, b, o, P3(1, 1, 0))
            d.parameter.expression = expr
        except Exception as ex:
            notes.append("dimension %s: %s" % (expr, ex))

    def rect(sk, w_expr, h_expr, cx=0.0, cy=0.0):
        w, h = um.evaluateExpression(w_expr, "cm"), um.evaluateExpression(h_expr, "cm")
        lines = sk.sketchCurves.sketchLines.addCenterPointRectangle(P3(cx, cy, 0), P3(cx + w / 2, cy + h / 2, 0))
        # lines 0/2 run along sketch x, 1/3 along sketch y
        dim(sk, lines.item(0).startSketchPoint, lines.item(0).endSketchPoint, w_expr, True)
        dim(sk, lines.item(1).startSketchPoint, lines.item(1).endSketchPoint, h_expr, False)
        return lines

    def circle(sk, d_expr, cx=0.0, cy=0.0):
        c = sk.sketchCurves.sketchCircles.addByCenterRadius(P3(cx, cy, 0), um.evaluateExpression(d_expr, "cm") / 2)
        try:
            sk.sketchDimensions.addDiameterDimension(c, P3(cx + 1, cy + 1, 0)).parameter.expression = d_expr
        except Exception as ex:
            notes.append("diameter %s: %s" % (d_expr, ex))
        return c

    def extrude(sk, prof, dist_expr, op, name, want_axis=None, want_sign=None):
        """Grows the profile away from its sketch plane toward want_sign on model axis want_axis (0=X,1=Y,2=Z).
        A positive distance follows the sketch normal, so the sign comes from that normal. Cuts are symmetric."""
        if op == CUT:
            ei = ext.createInput(prof, op)
            ei.setSymmetricExtent(VI(dist_expr), True)
            f = ext.add(ei)
        else:
            expr = dist_expr
            if want_axis is not None:
                o, z = sk.sketchToModelSpace(P3(0, 0, 0)), sk.sketchToModelSpace(P3(0, 0, 1))
                if [z.x - o.x, z.y - o.y, z.z - o.z][want_axis] * want_sign < 0:
                    expr = "-(" + dist_expr + ")"
            f = ext.addSimple(prof, VI(expr), op)
        f.name = name
        return f

    yz = comp.yZConstructionPlane
    # flange
    sk = sketches.add(yz); sk.name = "flange"
    rect(sk, "tb_flange_w", "tb_flange_h")
    flange = extrude(sk, sk.profiles.item(0), "tb_flange_t", NEW, "flange", 0, +1)
    body = flange.bodies.item(0)
    body.name = "Holley 112-583 (rough)"
    # main block
    pl = offset_plane(yz, "tb_flange_t", "block start")
    sk = sketches.add(pl); sk.name = "block"
    rect(sk, "tb_body_w", "tb_body_h")
    extrude(sk, sk.profiles.item(0), "tb_body_len - tb_flange_t", JOIN, "block", 0, +1)
    # coupler spigot
    pl = offset_plane(yz, "tb_body_len", "spigot start")
    sk = sketches.add(pl); sk.name = "spigot"
    circle(sk, "tb_inlet_od")
    extrude(sk, sk.profiles.item(0), "tb_spigot_len", JOIN, "inlet spigot", 0, +1)
    # side bosses on the shaft axis: TPS (+Y), cable wheel (-Y)
    xz = comp.xZConstructionPlane
    for nm, off, d, L, sign in (("TPS", "tb_body_w / 2", "tb_tps_d", "tb_tps_len", +1), ("cable wheel", "-tb_body_w / 2", "tb_wheel_d", "tb_wheel_t", -1)):
        pl = offset_plane(xz, off, nm + " plane")
        sk = sketches.add(pl); sk.name = nm
        shaft = sk.modelToSketchSpace(P3(um.evaluateExpression("tb_shaft_x", "cm"), 0, 0))
        circle(sk, d, shaft.x, shaft.y)
        extrude(sk, sk.profiles.item(0), L, JOIN, nm, 1, sign)
    # IAC block under the body
    xy = comp.xYConstructionPlane
    pl = offset_plane(xy, "-tb_body_h / 2", "IAC plane")
    sk = sketches.add(pl); sk.name = "IAC"
    c = sk.modelToSketchSpace(P3(um.evaluateExpression("tb_shaft_x", "cm"), 0, 0))
    rect(sk, "tb_iac_h", "tb_iac_w", c.x, c.y)
    extrude(sk, sk.profiles.item(0), "tb_iac_len", JOIN, "IAC", 2, -1)
    # bore through everything, and the four bolt holes
    sk = sketches.add(yz); sk.name = "bore"
    circle(sk, "tb_bore")
    extrude(sk, sk.profiles.item(0), "2 * (tb_body_len + tb_spigot_len)", CUT, "105 mm bore")
    sk = sketches.add(yz); sk.name = "bolt holes"
    s = um.evaluateExpression("tb_bolt_sq", "cm") / 2
    for (a, b) in ((s, s), (-s, s), (s, -s), (-s, -s)):
        circle(sk, "tb_bolt_d", a, b)
    profs = adsk.core.ObjectCollection.create()
    for i in range(sk.profiles.count):
        profs.add(sk.profiles.item(i))
    extrude(sk, profs, "2 * tb_flange_t", CUT, "bolt holes")
    body = comp.bRepBodies.item(0)
    body.name = "Holley 112-583 (rough)"
    bb = body.boundingBox
    return {"component": comp.name, "bodies": comp.bRepBodies.count,
            "box_mm": [round(10 * x, 1) for x in (bb.minPoint.x, bb.maxPoint.x, bb.minPoint.y, bb.maxPoint.y, bb.minPoint.z, bb.maxPoint.z)],
            "volume_cm3": round(body.volume, 1), "notes": notes}


print(run())   # the Fusion MCP runner executes the file top to bottom
