# Hanger isolation (hot) and bracket lightening: sourced data

Compiled 2026-11-03. This adds to `hangers_brackets.md` and does not repeat it: the GSI, Deeds and McMaster 500 °F silicone items, the SendCutSend and OSH Cut rules, the MEIC-14 hanger force and the Deeds swing note are all there. Every number below comes from the linked source. "n/f" means not found. Values in brackets are unit conversions only.

## A1. Elastomer temperature limits

| Material | Parker O-Ring Handbook, service range [1] | Datwyler, max continuous (1000 h, air) [2] | JIOrings, continuous / peak [3] |
|---|---|---|---|
| Natural rubber | n/f | 158 °F (70 °C) | n/f |
| Neoprene (CR) | −60 to 225 °F (−51 to 107 °C); heat text says "up to ~121 °C" | 225 °F | 100 / 120 °C |
| EPDM | −70 to 250 °F (−57 to 121 °C); "150 °C (max 204 °C) in water" | 300 °F | 110 / 130 °C |
| Nitrile, general | −30 to 250 °F (−34 to 121 °C) | 275 °F | 100 / 120 °C |
| Silicone (VMQ) | −175 to 450 °F (−115 to 232 °C); "~204 °C, special compounds 260 °C (500 °F)" | 525 °F | 160 / 180 °C |
| Fluorosilicone | −100 to 350 °F (−73 to 177 °C) | 450 °F | 180 / 200 °C |
| FKM | −15 to 400 °F (−26 to 205 °C) | 500 °F | 200 / 220 °C |
| Polyurethane | −40 to 180 °F (−40 to 82 °C) | 250 °F | 80 / 100 °C |

The sources disagree; Datwyler is highest. Parker shows a short-term band only as a chart ([1] Fig. 2-3).

Polyurethane from a PU maker (Pepson [4]): standard grades −40 to 93 °C (200 °F) dry, short-term 121 °C (250 °F). Above 70 °C in humid conditions polyester PU degrades by hydrolysis. Special grades go to 150 °C (300 °F), and breakdown starts above 180 °C.

What poly hanger sellers publish:
- Energy Suspension, Prothane, Whiteline, Powerflex [5], ATRO "High Temp" [7]: no number published.
- Nolathane: PU "isn't suited to... extreme heat"; hangers near the manifold or cat "run much hotter" [6].

Silicone hangers:
- Stainless Works EXGRO: no number published.
- BOOST EX-HG-02 reinforced silicone: "continuous use up to 220 °C" [8].
- de Havilland DSC 150 cushioned P-clamps: fabric-supported silicone cushion is −65 to +500 °F and is to be used only in +275 to +500 °F zones. The 2024-T4 band is rated to 275 °F and the CRES 301/302 band to 900 °F [9].

## A2. All-metal isolators

**Knitted stainless mesh**

| Item | Temp | Load | f_n / damping | Size, fixing | Src |
|---|---|---|---|---|---|
| Paulstra/Hutchinson steel cushions (general) | −70 to +300 °C | n/f | down to 3 Hz (with springs); damping 10–20 % | n/f; covers marine diesel exhaust pipe mounting, 5–20 dB(A) noise reduction | [10] |
| Vibratec VT1502 (smallest) | −90 to +300 °C | 20–250 daN | 15–22 Hz; amplification < 6 | 53 × 16 × 14 (A, B, H; units not stated); ±0.3 mm max amplitude; 5 g | [11] |
| Vibratec V43W/HW | −90 to +300 °C | 50–350 daN | 15–20 Hz; Q < 4 | Ø80/95, M16 stud; "stabilisation of exhaust pipes" | [12] |
| Vibratec VTCI-300F | −90 to **+600 °C** | 100–300 daN | 15–20 Hz; < 6 | 121 × 99 mm, M12, 0.8 kg; used to suspend exhaust pipes "on ships and in vehicles" | [13] |
| AAC V10Z22 mesh/spring | −70 to +175 °C | 0.7–110 kgf range (this SKU 5.6 kg) | 7–10 Hz vertical, 4.5–6 Hz transverse | ¼-20 to ⅜-24 | [14][15] |
| Barry 1202-2A Met-L-Flex | n/f | 12.5 lb max | n/f | 1.31 H × 2.38 W in | [16] |

Cushyfoot is rubber, 50–1,280 kg [18]. No OEM "mesh ring" hanger datasheet was found.

**Wire rope (stainless cable, aluminium bars)**

| Model | H × W (in) | Bar / holes | Max static, compression | Kv, compression | Temp | Src |
|---|---|---|---|---|---|---|
| Enidine WR2-100…-800 | 0.70×1.00 … 1.30×1.50 (18×25 … 33×38 mm) | bar 3.13 in (79.5 mm), drawing dim 2.690 in (68.3 mm); 4 holes Ø.185 in or #8-32 (M4); cable Ø.062 in | 10.5 lb (47 N) … 4.5 lb (20 N) | 205 … 45 lb/in (36 … 7.9 kN/m) | −150 to 500 °F (−100 to 260 °C) | [19] |
| Enidine WR3-100…-800 | 0.90×1.10 … 1.50×1.70 | bar 4.42 in (112.3 mm), 3.950 in (100.3 mm); Ø.219 in or #10-32 (M5); cable Ø.094 in | 19 lb (85 N) … 9 lb (40 N) | 370 … 90 lb/in | same | [19] |
| Socitec HH02-304…-1004 (half-helical) | 0.71×0.98 … 1.5×1.7 | Ø0.18 in or 8-32 | 5.8 … 1.6 lbf | max-vibration f 12.3 … 6.4 Hz (compression) | −290 to 570 °F (−180 to 300 °C) | [20] |

WR2 shear/roll ratings run from 5.0 lb (22 N) at 80 lb/in down to 2.5 lb (11 N) at 13 lb/in. WR2/WR3 inserts take at most 6 in·lb (0.7 N·m). Enidine gives damping of 5–15 % [19].

Enidine sizing rule: for 80 % isolation, f_n = f_excitation / 3.0, and Kv,max = W·(2πf_n)²/g [19]. The worksheet prints "(2ƒn)"; the π is taken to be lost in text extraction.

No automotive or motorsport exhaust use of wire-rope isolators was found. IDC and Sinusoidal were not checked.

## A3. Design guidance

- MEIC-14 paper [21]. Idle excitation is 22–28 Hz (cold and warm idle). Isolator Z stiffness of 30, 50, 100, 150, 200 and 300 N/mm was studied. Z stiffness strongly affects the first torsional mode and only weakly affects the first bending mode, both in the 30–50 Hz band. The hanger force limit was 5.00 N, and the result was 4.25 N.
- SAE 2017-26-0291: places hangers at nodal points, then uses DoE and optimisation. The abstract gives no numbers [22].
- Ford US 6,572,070: grommets are "EPDM or silicon rubber". The bracket is SAE 1008/1018 galvanized steel with an integral heat shield that protects the grommets. No numbers are given [23].
- Hanger spacing, a dynamic load factor and heat-shield standoff dimensions: **n/f**.

## A4. Fin-cooling inputs

| Property | Value | Src |
|---|---|---|
| k, 304 | 16.2 W/m·K at 100 °C; 21.4 at 500 °C | Cleveland-Cliffs [25] |
| k, 1018 | 51.9 W/m·K (the sheet says it is based on "similar materials") | Elgin [26] |
| k, 6061-T6 | 167 W/m·K at 77 °F | AA via Aerospace Metals [27] |
| ε, polished stainless sheet | 0.14 at 70 °C | Optris [28] |
| ε, 18-8 oxidised at 800 °C | 0.85 at 60 °C | Optris |
| ε, rolled / sandblasted stainless | 0.45 / 0.7 at 700 °C | Optris |
| ε, oxidised steel | 0.78–0.82 at 125–525 °C | Optris |
| ε, polished aluminium | 0.04–0.06 | Optris |

## B1. Dimple dies

| Maker | Hole cut | Finished OD | Max thickness | Src |
|---|---|---|---|---|
| Eastwood 21316 | punches 1/2, 1, 1-1/2, 2, 2-1/2 in | "flare width" 0.7, 1.4, 2.15, 2.85, 3.5 in | 1/8 in MS, 1/8 in Al, 3/32 in SS | [29] |
| SWAG 8-pc tube set | n/f | die OD 1.20, 1.45, 1.95, 2.40, 2.70, 3.17, 3.40, 4.20 in for 1/2 … 2-1/2 in | 3/16 in steel | [30] |
| SWAG pipe set (3/4, 1, 1.25, 1.5, 2 in pipe) | n/f | dimple OD 1.115, 1.362, 1.6875, 1.9375, 2.375 in | 3/16 in steel; knockout-punch method 11 ga MS / 16 ga SS | [31] |
| McMaster 3423N61 | 1/2 … 2-1/2 in (8 sizes) | 1-1/4, 1-1/2, 2, 2-3/8, 2-3/4, 3-1/8, 3-3/8, 4-1/4 in | 3/16 in steel | [32] |
| JMR (1/2 – 3-1/2 in) | finished hole = hole + 0.084 in (approx., 14 ga) | flare height 0.176 in | 1/8 in 4130 | [33] |
| Woodward Fab PF4 (1/2–3 in) | "small pilot hole" | n/f | 1/16 in (16 ga) MS, 14 ga Al | [35][36] |
| Dagger MA04E, 2 in | 2 in punch, 1/2 in pilot | about +1/2 in on diameter; about 1/4 in tall | 16 ga MS, 14 ga Al, 19 ga SS | [37] |

Ricks Stainless and PPI: n/f.

## B2. Aerospace flanged lightening holes

**de Havilland DS 11** (flanged lightening holes) [39]. Rules on the drawing:
- Total depth = D + t.
- OML diameter = B − 0.828t.
- In primary structure, edge dimension A must not exceed E or F. The drawing also shows .50, .75 and 1.00 MIN, but the extracted text does not show which dimensions they apply to.

| Punched A (in) | Form block B | Clearance C | Flange ht D |
|---|---|---|---|
| .50 / .75 / .80 | .75 / 1.00 / 1.10 | – | .10 |
| 1.00 / 1.25 / 1.50 / 1.75 / 2.00 | 1.38 / 1.62 / 1.87 / 2.12 / 2.44 | 1.81 / 2.00 / 2.30 / 2.50 / 2.87 | .12 |
| 2.25 / 2.50 / 2.75 / 3.00 | 2.87 / 3.12 / 3.35 / 3.60 | 3.25 / 3.50 / 3.75 / 4.00 | .20 |
| 3.25 … 5.00 (¼ in steps) | 4.12 … 5.87 | 4.50 … 6.30 | .32 |
| 5.50 / 6.00 / 6.50 / 7.00 | 6.62 / 7.12 / 7.62 / 8.12 | 7.00 / 7.50 / 8.00 / 8.50 | .38 |

Bend radii (Table 1) are listed for 2024-T3: .06/.15/.25/.38. The gauge each radius applies to cannot be read from the extracted text.

**NACA ARR L-323** (Kuhn, 1942; 24S-T, 45° flanges, clear diameter ≈ 0.9 × root diameter) [41]:
- Tested range: 0.15 < D/h < 0.75; h/t 45–300; b/D 1.5–2.6; c/h 0.14–1.4.
- The design allowable uses k_all = 0.85 − 0.0006·h/t.
- At the optimum hole spacing, strength-to-weight is "nearly independent of hole size". Larger holes gain a little, but at the cost of shear stiffness.
- The formulas apply only when the attachment flanges are not highly stressed.

**NACA RB 4B23** (Levin, 1944) [42]: beams with large holes need an interaction correction to pure-shear allowables; none was established.

Bruhn, Niu, MMPDS and AC 43.13-1B lightening-hole rules: **n/f** (not freely accessible).

## B3. Other cues

- PTC Creo defaults [43]: cut to cut ≥ 5t; cut to edge ≥ 2t; cut to bend ≥ 2.5t + R; wall height ≥ 1.5t + R; laser arc diameter ≥ 1.5t.
- Protolabs [44]: features within 4t of a bend may distort; flange ≥ 4t; hem ID ≥ t, return 6t; offsets 0.030 (recommended) to 0.312 in; tabs ≥ max(2t, 0.126 in), ≤ 5 × width.
- Bead radius/depth tables, gusset proportions and minimum cutout corner radii: **n/f**.
- NASA Isogrid Design Handbook (CR-124075) [46] advises against sharp corners at rib intersections. Its node fillet numbers were not legible in the scan.

## Notes for the generator

- The DS 11, DS 12 and DSC 150 PDFs carry a Bombardier proprietary notice. Check whether the tables can be used in an open-source tool, or cite them only.
- The mesh mounts' 15–22 Hz natural frequency sits just below the 22–28 Hz idle band in [21].

## Sources
[1] https://mfc.arizona.edu/sites/default/files/2022-02/parker_o-ring_handbook.pdf
[2] https://connectors.datwyler.com/wp-content/uploads/2020/06/Elastomer-Selection-Guide.pdf
[3] https://jiorings.com/en/content/334-temperature-resistance-in-elastomers
[4] https://pepsonpu.com/polyurethane-temperature-resistance/
[5] https://www.demon-tweeks.com/us/powerflex-performance-exhaust-mountings-246637/
[6] https://nolathane.com/us/search/exhaust-bushing/exhaust-bushing-for-
[7] https://www.raneystruckparts.com/atro-high-temp-exhaust-mounting-bushing-kit-m13-6001-m13-6004/
[8] https://dieselpowerproducts.com/products/exhaust-rubbers-heat-resistant
[9] https://supplier.aero.bombardier.com/DHC_isupply/dh/DSC/dsc150.pdf
[10] https://rodavigo.net/catalogos/PAULSTRA/Sistemas%20antivibratorios/PAULSTRA%2005%20Fijaciones%20de%20metal.pdf
[11] https://vibratec.org/product/metal-cushion-vt1502-vt1504-vt1505-vt1506
[12] https://vibratec.org/product/metal-isolation-mount-v43-v46
[13] https://www.vibratec.org/product/all-metal-mount-vtci-300f-vtci-700f/
[14] https://datasheets.globalspec.com/ds/designatronics/v10z22-7204a/18e534be-bfbe-452f-b512-e53c2ba42ff5
[15] https://www.machinedesign.com/archive/knitted-mesh-vibration-mounts
[16] https://www.hardwarespecialty.com/Catalog/Products/Electronic-Hardware/Shock-And-Vibration-Mounts/Metal-And-Mesh-Isolators/1284705
[17] https://pr.mono.ipros.com/en/hamagasu/product/detail/2000333097
[18] https://www.trelleborg.com/anti-vibration-solutions/products-and-solutions/anti-vibration-products/cushyfoot
[19] https://hasmak.com.tr/yeni/Tel-Halat-Teknolojisi-ingiliz-Metrik.pdf (Enidine ENI877R4, 2020)
[20] https://socitec-api.s3.amazonaws.com/pdfs/HH02_Spec_Sheet.pdf
[21] https://www.atlantis-press.com/article/15264.pdf
[22] https://papers.sae.org/publications/technical-papers/content/2017-26-0291/
[23] https://patents.google.com/patent/US6572070
[24] https://www.magnaflow.com/cdn/shop/files/0aefd77b1a104f402576ad6cc5d55b6c.pdf
[25] https://d1io3yog0oux5.cloudfront.net/_7ce3a04c09e74bf31ff5f89fc888db25/clevelandcliffs/db/1190/10510/file/CLF_ProductData_304-304LSS_052021.pdf
[26] https://www.mwcomponents.com/uploads/Resource-Center/Elgin-Material-Sheets/Carbon-Steel-Grade-1018-Data-Sheet_Elgin.pdf
[27] https://www.aerospacemetals.com/wp-content/uploads/2023/06/Aluminum-6061-T6-6061-T651.pdf
[28] https://optris.com/us/technology/emissivity-table/
[29] https://www.jbtools.com/eastwood-sheet-metal-hole-punch-and-flare-dimple-die-set-21316/
[30] https://www.swagoffroad.com/SWAG-8-Piece-Tube-Dimple-Die-Set-12-34-1-1-14-1-12-1-34-2-2-12_p_92.html
[31] https://www.swagoffroad.com/products/swag-pipe-dimple-dies-5-piece-set-3-4-1-1-1-4-1-1-2-2
[32] https://www.mcmaster.com/dimple-die-sets
[33] https://reach.dog/shop/jmr-manufacturing/products/jmr-dimple-dies-individual-sizes
[34] https://ca.tmrcustoms.com/products/dimple-die-5-piece-fabricator-set-includes-1-2-3-4-1-1-1-4-and-1-1-2-dies
[35] https://www.toolweb.com/hecpf13.html
[36] https://www.summitracing.com/parts/hck-pf4a
[37] https://www.daggertools.com/m5/MA04E--dagger-tools-sheet-metal-punch-and-flare-dimple-die-tools-metal-shaping-auto%20body-restoration%20.html
[38] https://baileigh.com/dimple-die-set
[39] https://supplier.aero.bombardier.com/DHC_isupply/dh/DS/ds11.pdf
[40] https://supplier.aero.bombardier.com/DHC_isupply/dh/DS/ds12.pdf
[41] https://ntrs.nasa.gov/api/citations/19930093634/downloads/19930093634.pdf
[42] https://ntrs.nasa.gov/api/citations/19930093353/downloads/19930093353.pdf
[43] https://support.ptc.com/help/creo/creo_pma/r7.0/usascii/sheetmetal/sheetmetaldesign/Set_Up/About_Design_Rules.html
[44] https://protolabs.com/services/sheet-metal-fabrication/design-guidelines
[45] https://www.rapiddirect.com/docs/sheet-metal-fabrication-design-guide.pdf
[46] https://ntrs.nasa.gov/api/citations/19730011184/downloads/19730011184.pdf
