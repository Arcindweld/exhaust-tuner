# Engine presets: sourced bore and stroke (2026-11-18)

Question (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A1 (b)): of the 592 four-stroke presets in the car and truck engine
list, 77 carried a bore and stroke; the other 515 had none, so the page estimated them from the displacement. That was the
largest gap in the presets' data. This round gives as many of them as could be done properly their real bore and stroke,
each from a citable source with the figures as written, the quality of the source, the date read and an arithmetic check,
and says on the page, wherever the figures are shown or used, which ones are still estimated.

Result in short: **144 of the 515** car-list presets now have a sourced bore and stroke (221 of 592 with one, against 77),
plus 4 vehicle-only entries and 6 presets that already had the same figures and now name a better source: 154 preset lines,
from 88 source entries, 137 of the lines from the maker's own published data. The estimate was wrong by -7 to +28 % in
stroke on the presets changed (median +9.8 %); it serves long-stroke engines worst, and those are most of the modern
turbocharged fours and sixes. In the wave simulation of 30 of the most-corrected presets, peak torque moved by
-10 to +3 % (median 5 % in size). Two findings are parked for review (one looks like a wrong displacement in a preset), and 371 car-list presets
still carry the estimate, now labelled as such.

## 1. How the page estimates, and whom it serves worst

`boreStroke()` (and the same lines in `simSpec`): with neither figure given, stroke S = (4 V / (pi x 1.44))^(1/3) for the
swept volume V of one cylinder, and bore B = 1.2 S. With one of them given, the other comes from the displacement. From
the bore and stroke follow, on the 4-Stroke tab: the valve heads the wave simulation scales when none is typed (intake
0.40 x bore with four valves, 0.49 with two; exhaust 0.34 / 0.40), the valve lifts from those, the rod (1.7 x stroke when
blank), the piston motion and mean piston speed, Taylor's valve sizes and Mach index, Smith's pipe rule, Stone's best
intake closing (3 deg per m/s of piston speed). The 4-Stroke tab's primary length and size (calcFour) do not use them.

For a real bore/stroke ratio r, the estimate's stroke is off by S_real / S_est = (1.2 / r)^(2/3) and its bore by
B_real / B_est = (r / 1.2)^(1/3); mean piston speed at a given RPM is off as the stroke. So the estimate is exact only at
r = 1.2 (a wide-bore V8 or a short-stroke racing flat-six), about 13 % short in stroke for a square engine (r = 1), 23 %
for the K24 (87 x 99, r = 0.88) and 28 % for the 2024 Mustang 2.3 EcoBoost (r = 0.83), and about 7 % long for the 997.2
GT3's 102.7 x 76.4 (r = 1.34). The layouts it served worst are therefore the long-stroke turbocharged fours, fives and
sixes (EA888, 2.5 TFSI, B48/B58, S55, M177/M178, 2.3 EcoBoost, K24), then the square engines (K20, FA20, 2JZ, the
2.7 EcoBoost) and the longer-stroke pushrod V8s (the 6.6 L8T, r = 1.05); engines near r = 1.2 come out close, and the
short-stroke GT flat-sixes a little long. Over the 148 presets changed the stroke error ran -7.3 to +28.2 %, median +9.8 %, and above 10 % for 73 of them.

## 2. What was done

- `tools/validation/presets/export.js`: every MOTORS and VEH entry (one source line each) with what the engine picker
  lists, as `worklist.json` (1,037 entries; the car and truck engine list 598, motorcycles 401).
- Triage by engine code and displacement (348 distinct code/cc pairs among the 515), worked through by likely use (GM
  small-block LS/LT, Ford Coyote, Modular, EcoBoost, Mopar HEMI and Viper, Honda K/B/C/F, Toyota and Lexus, Subaru FA,
  BMW M, VAG, Mercedes-AMG, Nissan VR/VQ, Hyundai-Kia) and by estimation error (long-stroke engines first).
- Sources in the order asked: the maker's published specification (press kits, technical data sheets, the maker's crate
  engine and industrial engine pages), then a reputable vendor's or magazine's figure, then an encyclopedia as a last
  resort and labelled as one. Forums were not used. A site that refused the fetch was not worked around.
- `tools/validation/presets/rs.js add` records one source entry at a time in `research.json` (the resumable checkpoint):
  the URL, the figures as written, the quality label, the date read, the presets it applies to, and the arithmetic check
  pi/4 x bore^2 x stroke x cylinders against each preset's displacement, 1 % (or the maker's stated cc, 2 % on the
  preset's figure); a preset outside it is not taken and lands in the review list with what was found.
- Compression, valves and redline only where the same source states them **for that model** (a sheet for another model
  year or rating gives bore and stroke only, said in the entry's note); a preset's existing compression is never
  overwritten (a differing one would be reported; none was). Rod length and firing order: no source in this round gave
  them.
- `tools/validation/presets/apply.js` writes research.json into the preset lines (`bore:..,stroke:..` after `cc`, `cr`
  and `valves` after them, `red` where it was `null`, and `bsSrc:'URL',bsQ:'label'` before `src`), deterministic and
  idempotent (a second run changes nothing; `--check` reports what would change). A preset that already had its own
  figures is left alone unless they agree, when only the source is added.
- Where a vendor's PDF text gave the labels apart from the values (BMW's 2017 M4 sheet), the figures were taken from a
  second sheet of the same maker that pairs them (BMW Canada's M3/M4 sheet, 84 bore x 89.6 stroke, which is also the only
  pairing that gives the stated 2979 cm3); inch-only figures (Ford's 2014 and 2020 F-150 and 2026 Mustang sheets) are
  converted and said so.

### On the page

- The preset note says, after "Bore and stroke ... mm": "(source: <maker data>)", the label linked to the bore-and-stroke
  source; for the 77 earlier presets "(from the source below: <kind>)", the kind of their own source from its address
  (`srcKind`: encyclopedia, maker data, magazine test, enthusiast reference). The figures now show to 0.01 mm (103.25, not
  103.3).
- A four-stroke preset without them says: "Bore and stroke: not in the sources found, so they are estimated from the
  displacement (bore 1.2 x stroke, B x S mm), and the 4-Stroke tab's valve sizes, rod and piston speed follow from that.
  Measure your engine's, or take them from its maker's data, and type them in on the 4-Stroke tab."
- The 4-Stroke tab's wave simulation says so above its results when the bore or stroke field is blank (`#sim-bsest`),
  with the figures it assumes; the head and valve rules section and Smith's rule already said "(estimated from the
  displacement)"; Stone's IVC hint now says its stroke was estimated.
- The "undefined" source links of part 14 do not return: every one of the 1,037 entries has a real address, and every
  engine preset note (999, both lists) was rendered and checked for an undefined link or NaN (presetdata_ui).
- A test hook `window.__presets` (MOTORS, VEH, ENGLIB, motorList, vehCode, vehMaker, boreStroke) for the tools and tests.

## 3. Coverage, before and after (car and truck engine list, four-strokes, by maker)

| Maker | Presets | With bore and stroke before | After |
|---|---:|---:|---:|
| Ford | 89 | 2 | 30 |
| Chevrolet | 71 | 9 | 16 |
| Porsche | 51 | 0 | 10 |
| BMW | 47 | 11 | 23 |
| Honda | 35 | 18 | 30 |
| Nissan | 28 | 3 | 10 |
| Dodge | 27 | 2 | 13 |
| Toyota | 18 | 6 | 13 |
| Mercedes-AMG | 18 | 2 | 14 |
| Ferrari | 16 | 3 | 3 |
| Volkswagen | 14 | 0 | 0 |
| Audi | 12 | 0 | 4 |
| Lamborghini | 12 | 0 | 0 |
| Chevrolet Performance | 9 | 9 | 9 |
| Subaru | 9 | 0 | 5 |
| Mercedes-Benz | 9 | 2 | 6 |
| Lotus | 9 | 0 | 0 |
| Mitsubishi | 8 | 0 | 0 |
| McLaren | 8 | 0 | 0 |
| Hyundai | 8 | 0 | 0 |
| Cadillac | 7 | 0 | 1 |
| Mazda | 7 | 2 | 2 |
| Buick | 6 | 0 | 0 |
| Lexus | 6 | 0 | 3 |
| Chevrolet / GMC | 5 | 1 | 2 |
| Acura | 5 | 0 | 5 |
| Chevrolet / Cadillac | 3 | 0 | 0 |
| Mopar | 3 | 1 | 3 |
| Volkswagen / Audi | 3 | 0 | 1 |
| Alfa Romeo | 3 | 0 | 0 |
| Chrysler | 3 | 1 | 3 |
| Jaguar | 3 | 0 | 0 |
| Aston Martin | 3 | 0 | 0 |
| Kia | 3 | 0 | 2 |
| Ford Performance | 2 | 1 | 1 |
| Ford Australia | 2 | 0 | 0 |
| Stellantis | 2 | 0 | 0 |
| Toyota / Lexus | 2 | 1 | 1 |
| Toyota / Subaru | 2 | 1 | 2 |
| Hyundai / Kia / Genesis | 2 | 0 | 1 |
| Plymouth | 2 | 0 | 0 |
| Ram | 2 | 0 | 1 |
| Fiat | 2 | 0 | 0 |
| Mini | 2 | 0 | 0 |
| Chevrolet / Pontiac | 1 | 0 | 0 |
| Chevrolet / Saturn | 1 | 0 | 0 |
| Dodge / Ram | 1 | 0 | 1 |
| Dodge / Chrysler | 1 | 1 | 1 |
| Dodge / SRT | 1 | 0 | 1 |
| Chrysler / Dodge / Jeep | 1 | 1 | 1 |
| Toyota / BMW | 1 | 0 | 1 |
| Nissan / Infiniti | 1 | 0 | 0 |
| Audi / Lamborghini | 1 | 0 | 1 |
| Audi / Porsche / Lamborghini | 1 | 0 | 0 |
| Hyundai / Kia | 1 | 0 | 1 |
| Pontiac | 1 | 0 | 0 |
| GMC | 1 | 0 | 0 |
| Infiniti | 1 | 0 | 0 |
| **All** | **592** | **77** | **221** |

## 4. Sources

| Quality label | Source entries | Preset entries given the source |
|---|---:|---:|
| maker data | 76 | 137 |
| reputable vendor | 9 | 10 |
| secondary: encyclopedia | 2 | 5 |
| magazine test | 1 | 2 |

The 88 entries (bore x stroke as taken; the figures as written, the presets and the notes are in research.json):

| Entry | Bore x stroke (mm) | Other fields | Quality | Source | Presets |
|---|---|---|---|---|---:|
| audi-25tfsi | 82.5 x 92.8 |  | maker data | https://www.audi-mediacenter.com/en/rs-3-sedan-216/technical-data | 1 |
| audi-25tfsi-400 | 82.5 x 92.8 | CR 10 | maker data | https://www.audi-mediacenter.com/en/rs-3-sedan-216/technical-data | 1 |
| audi-r8-v10 | 84.5 x 92.8 |  | maker data | https://uploads.audi-mediacenter.com/system/production/car_motorizations/335/file_en/824cd6b831b620f3969a43e61549348b22b8d6e6/eTechnische_Daten_Audi_R8V10_Coupe_419kW.pdf | 2 |
| audi-s3-8v | 82.5 x 92.8 |  | maker data | https://uploads.audi-mediacenter.com/system/production/car_motorizations/438/file_en/8f04843e0183f04234130a5af70abaa4f4f12fe7/etd_S3_2_0_TFSI_quattro_228_kW_0817.pdf | 2 |
| bmw-s55 | 84 x 89.6 |  | maker data | https://www.press.bmwgroup.com/canada/article/attachment/T0195811EN/285269 | 2 |
| bmw-s55-comp | 84 x 89.6 | CR 10.2 | maker data | https://www.press.bmwgroup.com/usa/article/attachment/T0250284EN_US/387874 | 1 |
| bmw-s55-gts | 84 x 89.6 | CR 10.2 | maker data | https://www.press.bmwgroup.com/usa/article/attachment/T0160684EN_US/391905 | 1 |
| bmw-s55-m3m4 | 84 x 89.6 | CR 10.2 | maker data | https://www.press.bmwgroup.com/canada/article/attachment/T0195811EN/285269 | 1 |
| bmw-s63t4 | 89 x 88.3 | CR 10, 4 valves | maker data | https://www.press.bmwgroup.com/usa/article/attachment/T0273727EN_US/399717 | 1 |
| bmw-s63t4c | 89 x 88.3 |  | maker data | https://www.press.bmwgroup.com/usa/article/attachment/T0273727EN_US/399717 | 1 |
| bmw-s65 | 92 x 75.2 | CR 12, 4 valves | maker data | https://www.press.bmwgroup.com/usa/article/attachment/T0017997EN_US/35557 | 2 |
| bmw-s85 | 92 x 75.2 | CR 12, 4 valves | maker data | https://www.press.bmwgroup.com/usa/article/attachment/T0018132EN_US/56945 | 3 |
| ford-23-ecoboost-2024 | 83.82 x 101.6 | CR 10.6 | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2026/specs/2026_Mustang_Technical_Specs.pdf | 1 |
| ford-23-ecoboost-mustang | 87.55 x 94 |  | maker data | https://media.ford.com/content/dam/lincolnmedia/lna/us/product/2016/2016-Ford-Mustang-Tech-Specs.pdf | 3 |
| ford-23-ecoboost-mustang-1517 | 87.55 x 94 | CR 9.5 | maker data | https://media.ford.com/content/dam/lincolnmedia/lna/us/product/2016/2016-Ford-Mustang-Tech-Specs.pdf | 1 |
| ford-27-ecoboost | 82.98 x 82.98 |  | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2020/specs/2020-F-150-Technical-Specs.pdf | 3 |
| ford-35-ecoboost-g2 | 92.46 x 86.61 | CR 10.5 | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2020/specs/2020-F-150-Technical-Specs.pdf | 1 |
| ford-35-ecoboost-ho | 92.46 x 86.61 | CR 10 | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2020/specs/2020-F-150-Technical-Specs.pdf | 2 |
| ford-35-ecoboost-ho21 | 92.46 x 86.61 |  | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2020/specs/2020-F-150-Technical-Specs.pdf | 1 |
| ford-35-ecoboost-other | 92.46 x 86.61 |  | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2020/specs/2020-F-150-Technical-Specs.pdf | 2 |
| ford-37-cyclone | 95.5 x 86.7 |  | maker data | https://media.ford.com/content/dam/lincolnmedia/lna/us/product/2016/2016-Ford-Mustang-Tech-Specs.pdf | 2 |
| ford-62-boss | 102.11 x 95 |  | maker data | https://cdn.base.parameter1.com/files/base/acbm/fcp/document/2013/06/2014-f150-specs_10978717.pdf | 2 |
| ford-coyote-gen1-truck | 92.2 x 92.71 | CR 10.5 | maker data | https://cdn.base.parameter1.com/files/base/acbm/fcp/document/2013/06/2014-f150-specs_10978717.pdf | 1 |
| ford-coyote-gen2 | 92.2 x 92.7 | CR 11 | maker data | https://media.ford.com/content/dam/lincolnmedia/lna/us/product/2016/2016-Ford-Mustang-Tech-Specs.pdf | 2 |
| ford-coyote-gen3 | 93 x 92.7 | CR 12 | maker data | https://media.ford.com/content/dam/fordmedia/Europe/documents/en/2022/2022_Mustang_Tech_Spec_EU.pdf | 1 |
| ford-coyote-gen3-truck | 92.96 x 92.71 | CR 12 | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2020/specs/2020-F-150-Technical-Specs.pdf | 2 |
| ford-coyote-gen3-truck21 | 92.96 x 92.71 |  | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2020/specs/2020-F-150-Technical-Specs.pdf | 1 |
| ford-coyote-gen3b | 93 x 92.7 |  | maker data | https://media.ford.com/content/dam/fordmedia/Europe/documents/en/2022/2022_Mustang_Tech_Spec_EU.pdf | 1 |
| ford-coyote-gen4 | 93 x 92.7 | CR 12 | maker data | https://performanceparts.ford.com/part/M-6007-M50D | 3 |
| ford-coyote-gen4dh | 93 x 92.7 | CR 12 | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2026/specs/2026_Mustang_Technical_Specs.pdf | 1 |
| gm-l84 | 96 x 92 |  | maker data | https://poweredsolutions.gm.com/products/engines/l84-engine | 1 |
| gm-l87 | 103.25 x 92 | CR 11.5, 2 valves | maker data | https://poweredsolutions.gm.com/products/l87-engine/ | 2 |
| gm-l8t | 103.25 x 98 | CR 10.8, 2 valves | maker data | https://poweredsolutions.gm.com/products/engines/l8t-engine | 2 |
| gm-lt1-gen5 | 103.25 x 92 | CR 11.5 | maker data | https://www.chevrolet.com/performance-parts/crate-engines/lt-engines/lt1-engine | 3 |
| gm-lt4 | 103.25 x 92 | CR 10 | maker data | https://www.chevrolet.com/performance/crate-engines/lt4.html | 4 |
| gm-lt6 | 104.25 x 80 |  | magazine test | https://www.enginelabs.com/?p=6198 | 2 |
| hon-b17a1 | 81 x 81.4 |  | secondary: encyclopedia | https://en.wikipedia.org/wiki/Honda_B_engine | 1 |
| hon-b18c | 81 x 87.2 |  | secondary: encyclopedia | https://en.wikipedia.org/wiki/Honda_B_engine | 4 |
| hon-c30a | 90 x 78 |  | maker data | https://acuranews.com/en-US/releases/release-f0234886aa7d781e2080c7004c34c8f7-2000-acura-nsx-nsx-t-specifications | 1 |
| hon-c32b | 93 x 78 | CR 10.2, 4 valves, redline 8000 | maker data | https://acuranews.com/en-US/releases/release-f0234886aa7d781e2080c7004c34c8f7-2000-acura-nsx-nsx-t-specifications | 2 |
| hon-f20c-02 | 87 x 84 | CR 11 | maker data | https://hondanews.com/en-US/releases/release-ac6c52b46473ca4f83631d004c34c7ed-2002-honda-s2000-specifications | 1 |
| hon-k20a-tr | 86 x 86 |  | maker data | https://global.honda/en/technical-review/PDF/012-2/012-2_45e.pdf | 9 |
| hon-k24z7-si13 | 87 x 99 | CR 11, 4 valves, redline 7000 | maker data | https://hondanews.com/en-US/honda-automobiles/releases/release-c93c7e8146714964a03663394bcf5e40-2013-honda-civic-si-specifications | 1 |
| kia-20t | 86 x 86 |  | maker data | https://kiamedia.com/us/es/models/stinger/2020/specifications | 1 |
| kia-20t-st | 86 x 86 | CR 10 | maker data | https://kiamedia.com/us/es/models/stinger/2020/specifications | 1 |
| kia-33t | 92 x 83.8 |  | maker data | https://kiamedia.com/us/es/models/stinger/2020/specifications | 1 |
| kia-33t-st | 92 x 83.8 | CR 10 | maker data | https://kiamedia.com/us/es/models/stinger/2020/specifications | 1 |
| mb-m156 | 102.2 x 94.6 |  | maker data | https://media.mbusa.com/releases/release-55aae03f47b344f4a0bc87e6ef5bac2e-2014-c63-amg-edition-507-technical-data | 2 |
| mb-m156-507 | 102.2 x 94.6 | CR 11.3 | maker data | https://media.mbusa.com/releases/release-55aae03f47b344f4a0bc87e6ef5bac2e-2014-c63-amg-edition-507-technical-data | 1 |
| mb-m157 | 98 x 90.5 |  | maker data | https://media.mbusa.com/releases/2017-mercedes-amg-cls63-s-coupe-specifications | 3 |
| mb-m177 | 83 x 92 |  | maker data | https://www.media.mbusa.com/releases/specs-2018-mercedes-amg-c63-coupe-and-c63-s-coupe | 4 |
| mb-m177-c63 | 83 x 92 | CR 10.5, redline 7000 | maker data | https://www.media.mbusa.com/releases/specs-2018-mercedes-amg-c63-coupe-and-c63-s-coupe | 2 |
| mb-m178 | 83 x 92 |  | maker data | https://media.mbusa.com/releases/release-f57992a15ff49dca22e3786155004fe5-2020-mercedes-amg-gt-r-and-gt-r-pro-coupe | 3 |
| mb-m178-gtr | 83 x 92 | CR 9.5, redline 7000 | maker data | https://media.mbusa.com/releases/release-f57992a15ff49dca22e3786155004fe5-2020-mercedes-amg-gt-r-and-gt-r-pro-coupe | 1 |
| moP-392-2012 | 103.9 x 94.5 | CR 10.9, redline 6400 | maker data | https://s3.amazonaws.com/chryslermedia.iconicweb.com/mediasite/specs/2012_DG_Challenger_SRT8392_SP.pdf | 1 |
| moP-392-2020 | 103.9 x 94.5 | CR 10.9, redline 6400 | maker data | https://a3.myautoworld.com/wp-content/uploads/2020/08/2020_DG_Challenger_ChallengerSRT_Specs.pdf | 1 |
| moP-392-other | 103.9 x 94.5 |  | maker data | https://a3.myautoworld.com/wp-content/uploads/2020/08/2020_DG_Challenger_ChallengerSRT_Specs.pdf | 3 |
| moP-57 | 99.5 x 90.9 |  | maker data | https://a3.myautoworld.com/wp-content/uploads/2020/08/2020_DG_Challenger_ChallengerSRT_Specs.pdf | 2 |
| moP-62sc-other | 103.9 x 90.9 |  | maker data | https://a3.myautoworld.com/wp-content/uploads/2020/08/2020_DG_Challenger_ChallengerSRT_Specs.pdf | 6 |
| moP-hellcat-2020 | 103.9 x 90.9 | CR 9.5, redline 6200 | maker data | https://a3.myautoworld.com/wp-content/uploads/2020/08/2020_DG_Challenger_ChallengerSRT_Specs.pdf | 1 |
| moP-redeye | 103.9 x 90.9 | CR 9.5 | maker data | https://a3.myautoworld.com/wp-content/uploads/2020/08/2020_DG_Challenger_ChallengerSRT_Specs.pdf | 1 |
| moP-viper-g5 | 103 x 100.6 |  | maker data | https://s3.amazonaws.com/chryslermedia.iconicweb.com/mediasite/attachments/2016_Dodge_Viper_Specs8p8494relih5em1i7jbcj7sinc.pdf | 2 |
| moP-viper16 | 103 x 100.6 | CR 10.2, redline 6400 | maker data | https://s3.amazonaws.com/chryslermedia.iconicweb.com/mediasite/attachments/2016_Dodge_Viper_Specs8p8494relih5em1i7jbcj7sinc.pdf | 1 |
| nis-vq37 | 95.5 x 86 | CR 11, redline 7500 | maker data | https://zcca.org/wp-content/uploads/2025/10/2020-Nissan-370Z-Coupe-Specifications.pdf | 1 |
| nis-vq37-m | 95.5 x 86 |  | maker data | https://zcca.org/wp-content/uploads/2025/10/2020-Nissan-370Z-Coupe-Specifications.pdf | 1 |
| nis-vq37-nismo | 95.5 x 86 | CR 11, redline 7500 | maker data | https://zcca.org/wp-content/uploads/2025/10/2020-Nissan-370Z-NISMO-Specifications.pdf | 1 |
| nis-vr38 | 95.5 x 88.4 |  | maker data | https://usa.nissannews.com/releases/2023-nissan-gt-r-press-kit | 3 |
| nis-vr38-2023 | 95.5 x 88.4 | CR 9, redline 7100 | maker data | https://usa.nissannews.com/releases/2023-nissan-gt-r-press-kit | 1 |
| por-992-gt3 | 102 x 81.5 | CR 13.3, redline 9000 | maker data | https://media.porsche.com/mediakit/911-gt3-touring-package/specifications/pdk/PAG-992-911GT3-TP-PDK-WLTP-EN.pdf | 1 |
| por-992-gt3rs | 102 x 81.5 | CR 13.3, redline 9000 | maker data | https://download.newsroom.porsche.com/dam/jcr:1d390f77-93c3-49c0-89c7-634f5f02b26a/S22_3515_en.pdf | 1 |
| por-997-carrera36 | 97 x 81.5 | CR 12.5 | reputable vendor | https://www.fcpeuro.com/blog/the-definitive-guide-to-porsche-997-engines | 1 |
| por-997-carreras38 | 102 x 77.5 |  | reputable vendor | https://www.fcpeuro.com/blog/the-definitive-guide-to-porsche-997-engines | 1 |
| por-997-gt2 | 100 x 76.4 | CR 9 | reputable vendor | https://www.fcpeuro.com/blog/the-definitive-guide-to-porsche-997-engines | 1 |
| por-997-gt3-38 | 102.7 x 76.4 | CR 12 | reputable vendor | https://www.fcpeuro.com/blog/the-definitive-guide-to-porsche-997-engines | 1 |
| por-997-gt3-38m | 102.7 x 76.4 |  | reputable vendor | https://www.fcpeuro.com/blog/the-definitive-guide-to-porsche-997-engines | 1 |
| por-997-gt3rs-38 | 102.7 x 76.4 | CR 12.2 | reputable vendor | https://www.fcpeuro.com/blog/the-definitive-guide-to-porsche-997-engines | 1 |
| por-997-gt3rs40 | 102.7 x 80.4 | CR 12.6 | reputable vendor | https://www.fcpeuro.com/blog/the-definitive-guide-to-porsche-997-engines | 1 |
| por-997-turbo38 | 102 x 77.5 | CR 9.8 | reputable vendor | https://www.fcpeuro.com/blog/the-definitive-guide-to-porsche-997-engines | 1 |
| sub-fa20 | 86 x 86 |  | maker data | https://s3.amazonaws.com/subarumedia.iconicweb.com/mediasite/attachments/2017_BRZ_Specs_2.0.pdf | 2 |
| sub-fa20-brz17 | 86 x 86 | CR 12.5 | maker data | https://s3.amazonaws.com/subarumedia.iconicweb.com/mediasite/attachments/2017_BRZ_Specs_2.0.pdf | 1 |
| sub-fa20dit | 86 x 86 |  | maker data | https://s3.amazonaws.com/subarumedia.iconicweb.com/mediasite/specs/2018_WRX_specs-FINAL15112017.pdf | 1 |
| sub-fa20dit-wrx | 86 x 86 | CR 10.6 | maker data | https://s3.amazonaws.com/subarumedia.iconicweb.com/mediasite/specs/2018_WRX_specs-FINAL15112017.pdf | 1 |
| sub-fa24-other | 94 x 86 |  | maker data | https://s3.amazonaws.com/subarumedia.iconicweb.com/mediasite/attachments/2022_WRX_Specs-FINAL.pdf | 2 |
| sub-fa24-wrx22 | 94 x 86 | CR 10.6 | maker data | https://s3.amazonaws.com/subarumedia.iconicweb.com/mediasite/attachments/2022_WRX_Specs-FINAL.pdf | 1 |
| toy-2jz-gte | 86 x 86 | CR 8.5 | reputable vendor | https://www.hpacademy.com/blog/everything-you-need-to-know-about-the-2jz-gte/ | 2 |
| toy-2ur-gse | 94 x 89.5 |  | maker data | https://media.lexus.co.uk/wp-content/uploads/sites/3/pdf/220201M-RC-F-Tech-Spec.pdf | 4 |
| toy-supra-20 | 82 x 94.6 | CR 10.2 | maker data | https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/240429-GR-Supra-Tech-Specs.pdf | 1 |
| toy-supra-30 | 82 x 94.6 |  | maker data | https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/240429-GR-Supra-Tech-Specs.pdf | 3 |

## 5. The 20 largest corrections (mean piston speed at the preset's redline)

| Preset | Estimate B x S | Sourced B x S | Stroke | Piston speed at redline | Intake valve (scaled) | Rod (1.7 x S) |
|---|---|---|---:|---|---|---|
| 5.2 FSI V10 (R8 V10, Gallardo LP 560, Huracán) | 92.6 x 77.2 | 84.5 x 92.8 | +20.2 % | 22.4 -> 26.9 m/s at 8700 | 37.1 -> 33.8 mm | 131.2 -> 157.8 mm |
| 2016–18 Audi R8 V10 plus (610 PS) | 92.6 x 77.2 | 84.5 x 92.8 | +20.2 % | 22.4 -> 26.9 m/s at 8700 | 37.1 -> 33.8 mm | 131.2 -> 157.8 mm |
| 2012–13 Honda Civic Si (K24Z7) | 96.5 x 80.4 | 87 x 99 | +23.1 % | 18.8 -> 23.1 m/s at 7000 | 38.6 -> 34.8 mm | 136.7 -> 168.3 mm |
| 2024+ Ford Mustang EcoBoost (2.3 L) | 95.1 x 79.3 | 83.82 x 101.6 | +28.2 % | 15.3 -> 19.6 m/s at 5800 | 38 -> 33.5 mm | 134.8 -> 172.7 mm |
| 2021+ Toyota GR Supra 3.0 (B58) | 91.4 x 76.2 | 82 x 94.6 | +24.2 % | 17.3 -> 21.4 m/s at 6800 | 36.6 -> 32.8 mm | 129.5 -> 160.8 mm |
| 2017+ Audi RS 3 / TT RS (2.5 TFSI 400 PS) | 91.2 x 76.0 | 82.5 x 92.8 | +22.1 % | 18.0 -> 22.0 m/s at 7100 | 36.5 -> 33 mm | 129.2 -> 157.8 mm |
| 2.5 TFSI inline-five turbo (RS 3, TT RS, RS Q3) | 91.2 x 76.0 | 82.5 x 92.8 | +22.1 % | 18.0 -> 22.0 m/s at 7100 | 36.5 -> 33 mm | 129.2 -> 157.8 mm |
| B18C5 1.8 VTEC (1997–2001 Integra Type R, US) | 88.2 x 73.5 | 81 x 87.2 | +18.6 % | 20.6 -> 24.4 m/s at 8400 | 35.3 -> 32.4 mm | 125 -> 148.2 mm |
| 1997–2001 Acura Integra Type R (B18C) | 88.2 x 73.5 | 81 x 87.2 | +18.6 % | 20.6 -> 24.4 m/s at 8400 | 35.3 -> 32.4 mm | 125 -> 148.2 mm |
| M178 4.0 twin-turbo V8 dry-sump (AMG GT) | 91.3 x 76.1 | 83 x 92 | +20.9 % | 18.3 -> 22.1 m/s at 7200 | 36.5 -> 33.2 mm | 129.3 -> 156.4 mm |
| 2015–17 Mercedes-AMG GT S (M178) | 91.3 x 76.1 | 83 x 92 | +20.9 % | 18.3 -> 22.1 m/s at 7200 | 36.5 -> 33.2 mm | 129.3 -> 156.4 mm |
| B58 3.0 turbo I6 (GR Supra 3.0, 2021+) | 91.4 x 76.2 | 82 x 94.6 | +24.2 % | 15.5 -> 19.2 m/s at 6100 | 36.6 -> 32.8 mm | 129.5 -> 160.8 mm |
| 2017–21 Mercedes-AMG GT R (M178) | 91.3 x 76.1 | 83 x 92 | +20.9 % | 17.8 -> 21.5 m/s at 7000 | 36.5 -> 33.2 mm | 129.3 -> 156.4 mm |
| 2015–21 Mercedes-AMG C 63 W205 (M177) | 91.3 x 76.1 | 83 x 92 | +20.9 % | 17.8 -> 21.5 m/s at 7000 | 36.5 -> 33.2 mm | 129.3 -> 156.4 mm |
| 2015–21 Mercedes-AMG C 63 S W205 (M177) | 91.3 x 76.1 | 83 x 92 | +20.9 % | 17.8 -> 21.5 m/s at 7000 | 36.5 -> 33.2 mm | 129.3 -> 156.4 mm |
| B18C1 1.8 VTEC (1994–2001 Integra GS-R) | 88.2 x 73.5 | 81 x 87.2 | +18.6 % | 19.6 -> 23.3 m/s at 8000 | 35.3 -> 32.4 mm | 125 -> 148.2 mm |
| 1994–2001 Acura Integra GS-R (B18C1) | 88.2 x 73.5 | 81 x 87.2 | +18.6 % | 19.6 -> 23.3 m/s at 8000 | 35.3 -> 32.4 mm | 125 -> 148.2 mm |
| 2016 BMW M4 GTS (S55, water injection) | 91.2 x 76.0 | 84 x 89.6 | +17.9 % | 19.3 -> 22.7 m/s at 7600 | 36.5 -> 33.6 mm | 129.2 -> 152.3 mm |
| S55B30 3.0 twin-turbo I6 (M3 F80, M4 F82, M2 Competition) | 91.2 x 76.0 | 84 x 89.6 | +17.9 % | 19.3 -> 22.7 m/s at 7600 | 36.5 -> 33.6 mm | 129.2 -> 152.3 mm |
| 2015–18 BMW M3 F80 / M4 F82 (S55) | 91.2 x 76.0 | 84 x 89.6 | +17.9 % | 19.3 -> 22.7 m/s at 7600 | 36.5 -> 33.6 mm | 129.2 -> 152.3 mm |

Stroke error of the estimate over the 148 changed presets: -7.3 to +28.2 %, median 9.8 %; |error| above 10 %: 73.

The wave simulation, the 30 picker presets with the largest stroke corrections (one per source entry): each preset chosen
in a fresh page, the page before this round (git 0c8fcfb) and this page, the design as entered run at the 12 speeds the
page runs, WebAssembly back end, short run control (2 first cycles, 1, 1 extra pair, 20 mm grid), peak indicated torque
from IMEP x displacement / 4 pi. The "after" includes the compression and redline where the round sourced them.

| Preset (picker) | Stroke | Peak torque before -> after (N m, rpm) | Change | VE at the peak | Highest VE |
|---|---:|---|---:|---|---|
| 2JZ-GTE 3.0 twin-turbo I6 (Supra Turbo, US) | +12.9 % | 406.6 @ 6050 -> 365.9 @ 6050 | -10 % | 1.1792 -> 1.1535 | 1.1792 -> 1.1535 |
| 4.0 L M178 4.0 (hot-V), 577 hp (as fitted: 2017–21 Mercedes-AMG GT R (M178)) | +20.9 % | 498.2 @ 5250 -> 458.4 @ 4150 | -8 % | 1.1019 -> 1.0725 | 1.1019 -> 1.0725 |
| 3.0 L S55B30, 425 hp (as fitted: 2015–18 BMW M3 F80 / M4 F82 (S55)) | +17.9 % | 373.1 @ 5100 -> 345.3 @ 4650 | -7.5 % | 1.1088 -> 1.0658 | 1.1111 -> 1.0658 |
| 2.0 L B48B20 (Supra), 255 hp (as fitted: 2021+ Toyota GR Supra 2.0 (B48)) | +24.2 % | 254.9 @ 5000 -> 236.4 @ 4150 | -7.3 % | 1.1175 -> 1.0668 | 1.1265 -> 1.0775 |
| 2.5 L 2.5 TFSI (DAZA/DNWA), 394 hp (as fitted: 2017+ Audi RS 3 / TT RS (2.5 TFSI 400 PS)) | +22.1 % | 314.3 @ 5400 -> 291.5 @ 4350 | -7.3 % | 1.12 -> 1.0718 | 1.12 -> 1.0803 |
| 4.0 L M177 4.0 (hot-V), 469 hp (as fitted: 2015–21 Mercedes-AMG C 63 W205 (M177)) | +20.9 % | 502.1 @ 5100 -> 468.2 @ 4650 | -6.8 % | 1.1106 -> 1.0609 | 1.1166 -> 1.0609 |
| 2.3 L 2.3 EcoBoost, 315 hp (as fitted: 2024+ Ford Mustang EcoBoost (2.3 L)) | +28.2 % | 283.6 @ 5100 -> 265.1 @ 4150 | -6.5 % | 1.1219 -> 1.0637 | 1.1219 -> 1.0637 |
| 2.0 L Theta II 2.0 T-GDi, 252 hp (as fitted: 2018–23 Kia Stinger 2.0T) | +12.9 % | 255.9 @ 5100 -> 239.2 @ 4600 | -6.5 % | 1.1279 -> 1.0909 | 1.1279 -> 1.0968 |
| EA888 Gen 3 2.0 TSI (Golf R, S3, GTI) | +22.1 % | 272.8 @ 6050 -> 257.3 @ 6050 | -5.7 % | 1.1969 -> 1.1452 | 1.1969 -> 1.1452 |
| M177 4.0 twin-turbo V8 (C 63 S, E 63 S, GT 63, G 63) | +20.9 % | 546.6 @ 6050 -> 516.7 @ 6050 | -5.5 % | 1.1898 -> 1.1412 | 1.1898 -> 1.1412 |
| 5.2 FSI V10 (R8 V10, Gallardo LP 560, Huracán) | +20.2 % | 705.8 @ 6150 -> 668.8 @ 5450 | -5.2 % | 1.1696 -> 1.119 | 1.1696 -> 1.119 |
| 3.0 L S55B30 (GTS), 493 hp (as fitted: 2016 BMW M4 GTS (S55, water injection)) | +17.9 % | 368.4 @ 5250 -> 349.4 @ 4150 | -5.2 % | 1.1039 -> 1.0703 | 1.1039 -> 1.0703 |
| 5.0 L Gen 1 Coyote (truck), 360 hp (as fitted: 2011–14 Ford F-150 (Coyote 5.0)) | +13.3 % | 618.7 @ 5100 -> 586.4 @ 4650 | -5.2 % | 1.107 -> 1.0675 | 1.107 -> 1.0675 |
| 2.3 EcoBoost turbo I4 (Mustang EcoBoost) | +18.4 % | 299.9 @ 6050 -> 284.7 @ 5100 | -5.1 % | 1.2059 -> 1.1338 | 1.2059 -> 1.1448 |
| B58 3.0 turbo I6 (GR Supra 3.0, 2021+) | +24.2 % | 403.5 @ 6250 -> 383.3 @ 5750 | -5 % | 1.1697 -> 1.1245 | 1.1697 -> 1.1245 |
| 2.3 L 2.3 EcoBoost, 310 hp (as fitted: 2015–17 Ford Mustang EcoBoost (2.3 L)) | +18.4 % | 276.6 @ 5100 -> 263.6 @ 4150 | -4.7 % | 1.1244 -> 1.0748 | 1.1244 -> 1.0869 |
| 2.0 L FA20DIT, 268 hp (as fitted: 2015–21 Subaru WRX (FA20F)) | +12.9 % | 257.4 @ 5100 -> 245.7 @ 4650 | -4.5 % | 1.135 -> 1.1032 | 1.135 -> 1.1032 |
| S55B30 3.0 twin-turbo I6 (M3 F80, M4 F82, M2 Competition) | +17.9 % | 404.5 @ 6050 -> 386.7 @ 6050 | -4.4 % | 1.1803 -> 1.1411 | 1.1803 -> 1.1411 |
| 3.0 L S55B30, 444 hp (as fitted: 2016–20 BMW M3 / M4 Competition Package (S55)) | +17.9 % | 364.2 @ 5200 -> 348.3 @ 4600 | -4.4 % | 1.103 -> 1.0757 | 1.103 -> 1.0757 |
| M178 4.0 twin-turbo V8 dry-sump (AMG GT) | +20.9 % | 534.7 @ 6300 -> 513 @ 5750 | -4.1 % | 1.1617 -> 1.1275 | 1.1619 -> 1.1275 |
| 2.5 TFSI inline-five turbo (RS 3, TT RS, RS Q3) | +22.1 % | 337.2 @ 5900 -> 324.7 @ 5900 | -3.7 % | 1.1717 -> 1.1476 | 1.1756 -> 1.1476 |
| B18C1 1.8 VTEC (1994–2001 Integra GS-R) | +18.6 % | 244.1 @ 6300 -> 235.5 @ 5650 | -3.5 % | 1.1737 -> 1.1425 | 1.1737 -> 1.1425 |
| Gen 2 Coyote 5.0 V8 (2015–17 Mustang GT) | +13.3 % | 664.9 @ 5900 -> 641.5 @ 5900 | -3.5 % | 1.1661 -> 1.1356 | 1.1661 -> 1.1356 |
| 2.4 L K24Z7, 201 hp (as fitted: 2012–13 Honda Civic Si (K24Z7)) | +23.1 % | 296.5 @ 5200 -> 306.1 @ 5200 | +3.2 % | 1.1193 -> 1.1331 | 1.1193 -> 1.1331 |
| 1.7 L B17A1, 160 hp (as fitted: 1992–93 Acura Integra GS-R (B17A1)) | +13.3 % | 214.7 @ 5000 -> 208.1 @ 5000 | -3.1 % | 1.1307 -> 1.1113 | 1.1307 -> 1.1113 |
| FA20DIT 2.0 turbo boxer (2015–21 WRX, Forester XT, Levorg) | +12.9 % | 274.3 @ 6050 -> 265.9 @ 6050 | -3.1 % | 1.1873 -> 1.1632 | 1.1873 -> 1.1632 |
| 2.7 EcoBoost twin-turbo V6 (F-150, Edge ST, Bronco) | +12.9 % | 369.6 @ 6300 -> 359.1 @ 5900 | -2.8 % | 1.1876 -> 1.1645 | 1.1876 -> 1.1645 |
| K20A 2.0 i-VTEC (JDM Integra Type R DC5, Civic Type R FD2) | +12.9 % | 276.8 @ 6000 -> 269.2 @ 6000 | -2.7 % | 1.1859 -> 1.1642 | 1.1859 -> 1.1642 |
| 2.0 L FA20, 205 hp (as fitted: 2017–20 Toyota 86 / Subaru BRZ (FA20, 205 hp)) | +12.9 % | 257.2 @ 5200 -> 253.4 @ 4600 | -1.5 % | 1.1359 -> 1.094 | 1.1359 -> 1.0946 |
| FA20 / 4U-GSE 2.0 boxer (86, BRZ, FR-S) | +12.9 % | 270.7 @ 6450 -> 267.7 @ 5800 | -1.1 % | 1.1732 -> 1.169 | 1.1732 -> 1.169 |

30 presets run; |peak torque change| median 5 %, largest 10 %.

Reading it: the longer stroke with the smaller bore (smaller scaled valves, a longer rod) mostly lowers the simulated
peak torque and VE of these engines a few per cent and moves nothing by much more than ten; the estimate had given these
long-stroke engines a wider bore and larger scaled valves than they have. The absolute torque is the model's, not the
maker's rating; what the table shows is how far the estimate had moved it. Two rows mix in a sourced compression the
preset had not had: the 2JZ-GTE (8.5:1 from HP Academy's factory figures; the largest drop, -10 %) and the K24Z7 Civic
Si (11.0:1 and its 7,000 rpm redline from Honda; the one rise, +3 %). The peak moved to a lower speed in about half the
rows, as a longer stroke at the same RPM runs a faster piston.

## 6. Needs review, and what is still estimated

Needs review:
- ford-f150-2014-37-35: the 3.45 in stroke of this sheet disagrees with Fords other sheets and with the displacement; not used (2014 F-150 sheet gives 3.7L V6 3.76 x 3.45 in. and 3.5L EcoBoost 3.64 x 3.45 in.; 3.76 x 3.45 x 6 = 3,770 cc against 3,726 (+1.2 %); the 2016 Mustang sheet gives the 3.7 as 95.5 x 86.7 mm and the 2020 F-150 the 3.5 as 3.64 x 3.41 in)
- ford-coyote-gen3b: the preset gives 4,951 cc (the Gen 1/2 figure) for the 2018-20 Mustang GT; Ford gives the Gen 3 Coyote as 5038 cc, 93.0 x 92.7 mm. The preset displacement looks wrong (owner to confirm); bore and stroke not applied to it

Searched without a usable source:
- hon-k24a8: hondanews.ca 2007 Accord sedan specifications (https://hondanews.ca/en-CA/hci-automobiles/releases/release-6b48bfbb4a461029754fc85dd70045a1-2007-accord-sedan-specifications): displacement 2354 cc and redline 6500, no bore and stroke
- hon-b16: Wikipedia Honda B engine read 2026-11-18: no entry under B16A2 or B16B by name
- sub-ej257: search for a Subaru media WRX STI specification sheet found none (only third-party spec sites)

Still estimated: 371 car-list four-stroke presets (and the 73 motorcycle presets without a bore and stroke, not part of
this round). By family the largest groups left are the Porsche flat-sixes of the 964 to 991 generations other than the
997s (Porsche's newsroom data sheets for the older models were not found by search), Ferrari, Lamborghini and McLaren
(their own model pages did not come up in search, and no maker sheet was reached), the classic GM, Ford and Mopar V8s of
the 1960s and 1970s (no maker data on line; a magazine source per engine would be needed), the Ford Modular 4.6 / 5.4 and
the 5.0 Windsor, BMW's older M engines (S14, S38, S50, S52, S54), N55 and the B58 in BMW cars (BMW's newer press sheets
redirect to a site that could not be read), the VW-badged EA888 / EA113 / VR6 presets (an Audi sheet was not applied to
a VW preset), Mitsubishi, Mazda, the Subaru EJ, Nissan's SR, RB, VQ35 and VG, and the Lotus-installed Toyota engines.
Each is a search for a maker sheet away; the tools take a new entry with one command, and apply.js and the test pick it
up.

## 7. Tests and pins

`web/tests/presetdata_ui.js` (new): research.json complete and self-consistent; apply.js has nothing left to write;
every preset entry with a bore and stroke (about 560, cars and bikes) within 2 % of its displacement; every entry's
source a real address; every bsSrc a real address with a quality label; the page's figures equal research.json's; all
999 engine preset notes rendered, none with an undefined link or NaN; every four-stroke preset without the figures shows
the estimate line with the hint, every one with them shows the source and label; the 4-Stroke tab's estimate line on an
unsourced preset and not on a sourced one; eight changed presets (one per quality label and cylinder count) run on both
engines with every number the same.

Pins: no numeric pin of the suite moved. K24A2 and the GM LS/LT engine presets the validation documents use (the MOTORS
LS and LT entries, the K24 journey) keep their figures: the LT1, LT4 and L8T engine presets had the same bore and stroke
as their new maker sources and only gained the source link; nothing found showed any of them wrong. Two tests changed for
the new text, not for numbers: motor_ui.js read the first 260 characters of the note for "Engine-only", which the new
bore-and-stroke line pushed out (it now reads 800); ui_ui.js's "nothing lost" word check caught the note's figures
going from 87.0 to 87 when they were first shown to two decimals, so the note keeps one decimal and shows two only where
the source has them (103.25).

Suite (web, parity, -j 2, --skip-slow) on the final code: 146 tests, 139 passed, 0 failed, 7 skipped and 7 partial skips (no OpenWAM build, no host program here); presetdata_ui among the passes.

## 8. How to rerun

    node tools/validation/presets/export.js                 # the work list (worklist.json)
    node tools/validation/presets/rs.js show [code regex]   # presets still without a sourced bore and stroke
    node tools/validation/presets/rs.js add <id> '<json>'   # one source entry (checked against the displacements)
    node tools/validation/presets/apply.js [--check]        # write research.json into web/index.html (idempotent)
    node tools/validation/presets/effect.js old=<page before> n=30   # results/effect.json (resumable)
    node tools/validation/presets/report.js                 # the tables of this document
    (cd web && node tests/presetdata_ui.js)
