"""Rough model of a K&N round tapered universal filter (RU / RC series): rubber flange, base end cap, pleated
element (as its envelope), top cap. K&N lists every universal filter by flange ID, flange length, base OD, top OD
and overall length; enter those for the part you have.

Frame: X along the filter axis, X = 0 at the flange's open end (where the intake tube slides in), +X toward the top
cap. Millimetres.

Run:  python kn_round_tapered.py OUT_DIR flange_id flange_len base_od top_od length [name]
      (inches if every value is under 30, millimetres otherwise)
"""
import sys
import cadquery as cq

IN = 25.4


def build(flange_id, flange_len, base_od, top_od, length, wall=6.0, cap=8.0):
    """flange_id: inside diameter of the rubber flange; length: overall, flange end to top cap."""
    fl_od = flange_id + 2 * wall
    flange = cq.Workplane("YZ").circle(fl_od / 2).circle(flange_id / 2).extrude(flange_len)
    base_cap = cq.Workplane("YZ").workplane(offset=flange_len).circle(base_od / 2).circle(flange_id / 2).extrude(cap)
    elem_len = length - flange_len - 2 * cap
    element = (cq.Workplane("YZ").workplane(offset=flange_len + cap).circle(base_od / 2)
               .workplane(offset=elem_len).circle(top_od / 2).loft())
    inner = (cq.Workplane("YZ").workplane(offset=flange_len + cap).circle(flange_id / 2)
             .workplane(offset=elem_len).circle(max(flange_id / 2 - 10.0, 5.0)).loft())
    top = cq.Workplane("YZ").workplane(offset=length - cap).circle(top_od / 2).extrude(cap)
    return flange.union(base_cap).union(element.cut(inner)).union(top)


if __name__ == "__main__":
    out = sys.argv[1]
    vals = [float(v) for v in sys.argv[2:7]]
    name = sys.argv[7] if len(sys.argv) > 7 else "kn_filter"
    if all(v < 30 for v in vals):
        vals = [v * IN for v in vals]
    s = build(*vals)
    cq.exporters.export(s, "%s/%s_rough.step" % (out, name))
    cq.exporters.export(s, "%s/%s_rough.stl" % (out, name), tolerance=0.1)
    print("flange ID %.1f, flange %.1f long, base %.1f, top %.1f, length %.1f mm" % tuple(vals))
