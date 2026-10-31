"""Rough model of the Holley EFI 112-583 billet 105 mm LS throttle body (straight bore, cable, 4-bolt LS flange),
for laying out an intake around a scan: the bore, the coupler spigot and the envelope the TPS, IAC and cable wheel
take up. It is not a manufacturing drawing of the part.

Every dimension is tagged: [Holley] from Holley's own page / instructions, [ICT] from ICT Billet's spacer for the
same flange, or [est] an estimate to replace with a measurement (see MEASURE at the bottom).

Frame: X along the air flow (X = 0 at the flange face that bolts to the intake, +X upstream toward the filter),
Y horizontal, Z up. Millimetres.

Run:  python holley_112_583.py OUT_DIR   (needs CadQuery; writes .step and .stl)
"""
import sys
import cadquery as cq

IN = 25.4
P = {
    # [Holley] 112-583 product page: "Bore diameter / throttle bore 105 mm; straight bore (no taper)"
    "bore": 105.0,
    # [Holley] installation instructions 510-112-581: air inlet O.D. 4 3/8" on 112-583 (4 1/4" on the tapered 112-581)
    "inlet_od": 4.375 * IN,
    # [Holley] same instructions: four M6x1 x 25 mm screws to the intake
    "bolt_d": 6.6,                # clearance hole for M6 (ISO 273 medium)
    # [ICT] ICT Billet's 1/2 in spacer for the 4-bolt 102 mm LS flange is 5 in x 5 in: the flange envelope
    "flange_w": 5.0 * IN,
    "flange_h": 5.0 * IN,
    "flange_r": 12.0,             # [est] corner radius
    "flange_t": 16.0,             # [est] flange thickness the 25 mm screws pass through
    "bolt_sq": 4.2 * IN,          # [est] bolt square, centre to centre; MEASURE (GM 4-bolt LS2/LS3 pattern not found published)
    "body_len": 60.0,             # [est] flange face to the start of the inlet spigot
    "body_w": 4.9 * IN,           # [est] main body width around the bore (billet block)
    "body_h": 4.7 * IN,           # [est]
    "spigot_len": 25.0,           # [est] coupler spigot length (a 4 3/8 in silicone coupler needs about 1 in of grip)
    "bead_h": 1.5,                # [est] retention bead height on the spigot
    "shaft_x": 36.0,              # [est] throttle shaft position from the flange face
    "tps_d": 55.0, "tps_len": 28.0,       # [est] TPS + clocker ring, driver's side (+Y)
    "wheel_d": 64.0, "wheel_t": 14.0,     # [est] cable wheel, passenger side (-Y), including the return springs
    "iac_w": 45.0, "iac_h": 40.0, "iac_len": 38.0,  # [est] IAC motor block, under the bore on the -Z side
}


def build(p=P):
    fl = (cq.Workplane("YZ").rect(p["flange_w"], p["flange_h"]).extrude(p["flange_t"])
          .edges("|X").fillet(p["flange_r"]))
    # bolt holes on a square
    s = p["bolt_sq"] / 2.0
    holes = cq.Workplane("YZ").pushPoints([(s, s), (-s, s), (s, -s), (-s, -s)]).circle(p["bolt_d"] / 2).extrude(p["flange_t"])
    fl = fl.cut(holes)
    body = (cq.Workplane("YZ").workplane(offset=p["flange_t"]).rect(p["body_w"], p["body_h"])
            .extrude(p["body_len"] - p["flange_t"]).edges("|X").fillet(18.0))
    spigot = cq.Workplane("YZ").workplane(offset=p["body_len"]).circle(p["inlet_od"] / 2).extrude(p["spigot_len"])
    bead = (cq.Workplane("YZ").workplane(offset=p["body_len"] + p["spigot_len"] - 6.0)
            .circle(p["inlet_od"] / 2 + p["bead_h"]).extrude(3.0))
    tps = (cq.Workplane("XZ").workplane(offset=-(p["body_w"] / 2)).center(p["shaft_x"], 0)
           .circle(p["tps_d"] / 2).extrude(-p["tps_len"]))
    wheel = (cq.Workplane("XZ").workplane(offset=p["body_w"] / 2).center(p["shaft_x"], 0)
             .circle(p["wheel_d"] / 2).extrude(p["wheel_t"]))
    iac = (cq.Workplane("XY").workplane(offset=-(p["body_h"] / 2) - p["iac_len"])
           .center(p["shaft_x"], 0).rect(p["iac_h"], p["iac_w"]).extrude(p["iac_len"]))
    solid = fl.union(body).union(spigot).union(bead).union(tps).union(wheel).union(iac)
    total = p["body_len"] + p["spigot_len"]
    solid = solid.cut(cq.Workplane("YZ").circle(p["bore"] / 2).extrude(total))
    return solid


MEASURE = [
    "bolt square centre to centre (or one horizontal and one vertical bolt spacing) and hole size",
    "flange thickness at the bolt holes; flange outline",
    "flange face to the start of the inlet spigot; spigot length; bead position and height",
    "body width and height; throttle shaft distance from the flange face",
    "TPS, cable wheel and IAC: outside size and how far each stands off the body",
]

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    s = build()
    cq.exporters.export(s, out + "/holley_112-583_105mm_rough.step")
    cq.exporters.export(s, out + "/holley_112-583_105mm_rough.stl", tolerance=0.1)
    bb = s.val().BoundingBox()
    print("envelope mm: X %.1f..%.1f  Y %.1f..%.1f  Z %.1f..%.1f" % (bb.xmin, bb.xmax, bb.ymin, bb.ymax, bb.zmin, bb.zmax))
    print("volume cm3: %.0f" % (s.val().Volume() / 1000.0))
