# Flange dimensions for the jig locators (2026-11-03)

Sources for `FLANGE_PRESETS` in web/index.html. All numbers are the makers' published figures. Our only arithmetic is
inch-to-mm conversion, plus jig plate outlines and clearance holes where none are published (marked "ours" in the
page's notes). Check the parts you have before printing a jig.

## Main sources
- Vibrant 2/3-bolt sheet: https://images.carid.com/vibrant-performance/products/pdf/stainless-steel-exhaust-flanges-and-gaskets-2-bolt-and-3-bolt-product-information.pdf
- Vibrant V-band sheet: https://images.carid.com/vibrant-performance/products/pdf/v-band-flange-assemblies-stainless-steel-and-aluminum-product-information.pdf
- Vibrant turbo/wastegate sheet: https://images.carid.com/vibrant-performance/products/pdf/turbo-flanges-and-wastegate-flanges-product-information.pdf (the numbers have no labels, so which number means what is our reading)
- Ace Race Parts V-band catalog 2022: https://cdn.shopify.com/s/files/1/0972/8304/files/V-Band_Dimension_Catalog_2022.pdf
- Ace turbo flange drawings: aceraceparts.com/pages/dimensional-drawing-of-turbo-... (linked per preset)
- turbozentrum.de flange pages (linked per preset)

## 2-bolt, Vibrant 147x (3/8 in thick; hole size not published, jig uses 10.5 mm)
| Tube | Part | W × H in | Bolt c-c in |
|---|---|---|---|
| 2.0 | 1470 | 4.90 × 3.00 | 3.50 |
| 2.25 | 1471 | 5.25 × 3.50 | 4.00 |
| 2.5 | 1472 | 5.25 × 3.50 | 4.00 |
| 3.0 | 1473 | 5.05 × 3.70 | 4.15 |

## 3-bolt, Vibrant 148x (3/8 in thick)
| Tube | Part | W × H in | Bolt circle in |
|---|---|---|---|
| 2.25 | 1481 | 3.90 × 3.90 | 3.25 |
| 2.5 | 1482 | 3.90 × 3.90 | 3.42 |
| 3.0 | 1483 | 4.37 × 4.31 | 3.88 |
| 3.5 | 1484 | 4.82 × 4.69 | 4.46 |
The triangle's bounding box is not centred on the tube, so the jig plate is a square centred on the tube, sized to the
bolt circle.

## V-bands
Ace Standard (clamps 22020–22028) and Quick Release (22120–22128): OD / retainer in inches.
| Tube | Standard OD | Standard retainer | QR OD | QR retainer |
|---|---|---|---|---|
| 2.0 | 2.559 | 2.019 | 2.735 | 2.177 |
| 2.5 | 3.083 | 2.539 | 3.237 | 2.667 |
| 3.0 | 3.583 | 3.039 | 3.750 | 3.176 |
| 3.5 | 4.080 | 3.539 | 4.232 | 3.667 |
| 4.0 | 4.567 | 4.023 | 4.750 | 4.176 |
Apex/base thickness: Standard 0.170/0.287 in, QR 0.137/0.210 in. Ace: the two types do not interchange; no industry
standard; no fit with other brands is guaranteed.

Vibrant 14xx: flange OD only, 65 / 81 / 96 / 105 / 117 mm for 2 / 2.5 / 3 / 3.5 / 4 in.

Male lip height and female recess depth are not published by anyone found (Ace, Vibrant, Ticon, Turbosmart, HPS,
Burns, 1320, Treadstone, ATP). So the male pocket is 4 mm deep (deeper than the lip), the female boss 1.2 mm tall
(shorter than the recess), and Vibrant uses a rim pocket at the OD.

## Turbo
- Inlets, 4 studs: T25/T28 73 × 40 mm M8 (turbozentrum; Vibrant 1430 72.3 × 40); T3 3.375 × 1.750 in M10 (Ace) or
  86 × 46 mm M8 (turbozentrum); T4 divided 3.250 × 2.750 in M10 (Ace), T4 single 83 × 70 mm M8 (turbozentrum);
  T6 4.500 × 2.750 in (Ace), BorgWarner 4.44 × 2.75 in. Sources disagree on thread and up to 1.5 mm on spacing.
- V-band inlets: Garrett GT30/35 OD 3.000 in, retainer 2.362 in; Tial OD 3.000 in, retainer 2.114 in.
- V-band outlets: Garrett GT30–GTX40 OD 3.551, retainer 3.204, ID 2.929 in; Tial GT OD 3.551, retainer 3.055 in.
  Tial discharge flanges: female 2499 / male 2500 (downpipe), OD 3.55 in.
- Bolted outlets: Garrett 4-bolt 63.5 mm, holes 89 mm across the diagonal, 9 mm; Vibrant 1438 4-bolt PCD 100.55,
  10.32 mm holes; Vibrant 1420 GT32 6-bolt PCD 99.95, 9.14 mm holes.
- 5-bolt T25/T3 outlets: outlines and 9 mm holes only, no coordinates: not in the presets.

## Wastegates
- Tial 38 mm 2-bolt: 84 mm hole spacing (one retailer).
- Tial V44 inlet (Vibrant 1411A): 56.95 / 48.16 / 40.64 / 63.37 mm, unlabelled; 63.37 taken as the rim.
- Turbosmart 40/45/50/60: no dimensions published.

## Wiggins (Eaton)
No ferrule dimensions found. The preset takes the OD you measure.
