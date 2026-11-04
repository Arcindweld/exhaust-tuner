# Merge collectors and Y merges (fusion-addin/merge.py)

What the add-in builds where tubes join, and why each number is what it is.

## Geometry

The router lays n tubes touching on a ring at the collector's inlet plane (`router.collector_slots`, ring radius
`od / (2 sin(pi/n))`) and gives the cone from the envelope round them, `d_in = 2 r_pack + od`, to the outlet OD over
the collector length (`router.collector_body`). `merge.plan` turns that into one welded part:

| Piece | Size | Why |
|---|---|---|
| Slip sleeve | ID = `d_in`, 3/4 in long (at most 0.9 x the tubes' last straight) | the primaries slip in; the crescent gaps between the tubes and the sleeve stay outside the gas path |
| Merge plate | inside the sleeve; one hole per tube, the tube's **bore**, on the tube's own centre; 1/8, 3/16 or 1/4 in stock, the thinnest at least 1.5 x the tube wall | holes the tubes' OD would touch each other and the rim at single points, which cannot be cut or welded. Bore holes leave exactly two walls between neighbours and one wall to the rim. The plate carries little load; it only has to take a fillet weld to the tube wall without burning through |
| Cone | sleeve diameter to the outlet OD, wall square to the axis | as before |
| Spike | a cone on the axis standing on the plate's solid middle, base radius = the gap's inscribed radius less half a wall | fills the dead centre between the tubes (n >= 4; for 2 and 3 tubes the gap is too small) |

## The spike's length

The open area along the merge is `A(x) = pi (R(x)^2 - r_s(x)^2)` with `R` the cone's inside radius (falling with
slope `R'`) and `r_s` the spike's (falling from `r_b` to 0 over `Ls`). `dA/dx <= 0` everywhere needs
`R |R'| >= r_s r_b / Ls`, worst at the plate, so `Ls >= r_b^2 / (R0 |R'|)`. A spike that ends sooner gives area back
faster than the cone takes it away: a short diffuser right where the pulses meet. The plan takes 1.15 times that, at
least 3 `r_b`, at most 0.9 of the cone; `test_merge.py` checks the area never grows. (This is our own area-continuity
argument, not a maker's published rule.)

Spikes 1.5 in across or wider are drawn as hollow cones one wall thick (rolled from the cone's sheet, closed
underneath by the plate); smaller ones are solid, to be turned from round bar.

## The cone's angle

Burns Stainless recommend a 15-degree merge angle for most collectors, about 7 to 17 or 18 degrees as the best range,
and 25 degrees only for tightly packaged turbo collectors ([Vince in Shorts, Collectors part one](https://burnsstainless.com/blogs/articles-1/vince-in-shorts-collectors-part-one)).
The plan reports the cone's included angle and adds a note outside 7 to 18 degrees. Burns also stress that the tubes
should be "cut and joined in a way that gives the exhaust gases a continuous path into the collector". A flat merge
plate does not do that fully: the open area steps from the bores to 1.5 to 2.4 times their area at the plate (the
spike takes a few per cent off). A formed (pie-cut) merge is smoother but needs press tooling; the flat plate is what
a shop with a laser and a TIG can make.

## Cut files

DXF R12 in millimetres, every entity on the CUT layer, one file per sheet thickness:

- the plate: the rim 0.15 mm under the sleeve's bore (a slip fit) and the bore holes;
- the cone (an annular sector), the sleeve (a rectangle) and a rolled spike (a full cone's sector), each developed at
  the middle of its wall, where a rolled sheet neither stretches nor shrinks, with a butt seam. For a frustum with
  mid-wall radii `ra > rb` and slant `s`: outer radius `R = s ra / (ra - rb)`, inner `R - s`, angle `2 pi ra / R`.

## Weight

Reported for 304 at 8.0 g/cm^3 from the plan's own volume (sleeve, cone shell, plate less holes, spike);
`fusion_live_merge.py` compares Fusion's body volume to the same figure.
