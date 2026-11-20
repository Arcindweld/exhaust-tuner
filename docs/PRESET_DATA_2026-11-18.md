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

**Round two (2026-11-20, section 9):** 421 of the 592 car-list four-stroke presets and 375 of the 392 motorcycle
four-strokes now have a sourced bore and stroke (175 more source entries); 171 and 17 still carry the estimate.

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

## 9. Round two (2026-11-20)

Same method, same scripts, same rules as sections 2 and 6: a figure is taken only from a page fetched in this round, in
the source order maker data -> reputable vendor or magazine -> encyclopedia, every entry through `rs.js add` with its URL,
the figures as written, the quality label, the date read (2026-11-20) and the pi/4 x B^2 x S x n check against each
preset (1 %); a preset that failed the check was not written. No forum was used, no encyclopedia was needed, and no
refused fetch was worked around (Summit Racing, JEGS tech articles, goo-net.com and Ford's media.ford.com 2021 Mustang
sheet refused or failed; other sources were used instead).

### Counts

| | Four-stroke presets in the picker | With bore and stroke before | After | Still estimated |
|---|---:|---:|---:|---:|
| Car and truck list | 592 | 221 | **421** | 171 |
| Motorcycles | 392 | 319 | **375** | 17 |

175 new source entries (263 in research.json), 274 preset lines given a sourced bore and stroke: 209 car-list entries
(200 more in the picker's list; the other 9 are vehicle entries the picker shows under another entry's engine)
and 56 motorcycle entries that had none, and 9 that had their own figures and now name the source as well (the LS3,
LS376/525, LSA, LS9, LS7, LS2, Voodoo 5.2 and M159 engine presets and the 2010-12 SLS AMG; their figures agree with the
source, apply.js keeps them). Compression, valves or redline were recorded only where the same source states them for
that exact model (48 entries carry one or more of them; apply.js writes them only where the preset has none); no
existing compression or other field was overwritten, and none differed.

Motorcycles: the bike presets are VEH lines in the same `{g:'bike',...,cc:..,src:..}` form as the cars, the export and
`rs.js add` already covered them (four-strokes only: `cyc === '4'`), so apply.js needed no extension; two-stroke presets
(cyc '2') and the rotary car presets (cyc 'r', not piston engines) were skipped by design and their data model is
untouched.

### Sources by quality (round two)

| Quality label | Source entries | Preset entries given the source |
|---|---:|---:|
| maker data | 65 | 101 |
| magazine test | 106 | 165 |
| reputable vendor | 4 | 8 |
| secondary: encyclopedia | 0 | 0 |

Unlike round one, magazine sources outnumber maker data: the makers' own sheets for the 1960s-2000s engines, the JDM
engines and most European exotics are not on line, so the figures come from magazines that print a specification
table (km77.com's technical data sheets, Over-Drive Magazine's model-year fact sheets, Motorcycle.com and Total
Motorcycle spec pages, Street Machine, Fast Car, WardsAuto's 10 Best Engines tables, LSX Magazine, Hagerty, Excellence).
Maker data includes the makers' press sheets (Porsche, BMW, Ford, Audi, Mercedes-Benz, Nissan/Infiniti, Honda, Suzuki,
Kawasaki, Yamaha, Ducati, BMW Motorrad, Triumph), Chevrolet Performance and GM pages, the Mercedes-Benz Classic archive,
and four owner's or instruction manuals of the maker as hosted by manual sites (Nissan 350Z 2003/2005/2008,
Mercedes SLS AMG 2011, Ford Racing M-6007-F50), said so in each note. Reputable vendor: the Goo-net Exchange catalog
for two JDM presets (S15 Silvia, Evolution IX), JEGS for the LS7 crate engine, CJ Pony Parts for the 2020 GT500.
Inch figures (the classic US engines, the Buick 3.8 and 455, the Raptor R Predator) were converted x 25.4 and the
as-written inches kept in each entry.

### Stroke error of the estimate on the newly sourced presets

The page's estimate (bore 1.2 x stroke from the displacement, section 1) against the sourced stroke:

| | Presets | Range | Median | abs > 10 % | abs > 20 % |
|---|---:|---|---:|---:|---:|
| Car list | 209 | -9.5 to +25.6 % | +7.5 % | 82 | 38 |
| Motorcycles | 56 | -24.9 to +21.1 % | -9.3 % | 32 | 6 |
| All | 265 | -24.9 to +25.6 % | +4.9 % | 114 | 44 |

Distribution (all): -30..-10 %: 26, -10..0 %: 71, 0..5 %: 39, 5..10 %: 40, 10..15 %: 27, 15..20 %: 19, 20..30 %: 43.
The largest: the 5.4 supercharged Modular of the 2007-12 GT500s (90.2 x 105.8, +25.6 %), the B58 in BMW cars (+24.2 %),
the VR6 3.2 (+23.3 %), and on the bikes the 1199 Panigale (112 x 60.8, -24.9 %). The long-stroke road engines are
estimated short as in round one; the motorcycles are the other way round, most of them oversquare beyond r = 1.2, so the
estimate gave them too long a stroke (median -9.3 %). The wave simulation's effect (effect.js) was not rerun for this
round.

### Needs review (round two; the two round-one items above stay open)

- ford-boss429-69: Over-Drive's 1969 and 1970 Mustang sheets give the Boss 429 as 4.36 x 3.959 in, which is 473 cu in,
  not 429 (+10.2 % on the preset); the stroke looks misprinted (4.36 x 3.59 would give 429). Not applied; the Boss 429
  stays estimated.
- gm-ls6-454-70: Over-Drive's 1970 Chevelle sheet gives the LS6 454 as 4.126 x 4.00 in (the 402's bore; 428 cu in,
  -5.8 %). Not applied from that sheet; the Chevelle took the LS6 454's 4.250 x 4.00 from the 1971 Corvette sheet of the
  same site (entry gm-ls6-454-70v, bore and stroke only).
- suz-gsxr1000-k1: Total Motorcycle's 2001 GSX-R1000 page gives 72.0 x 46.0 mm, the GSX-R750's figures (749 cc against
  988, -24.2 %). Not applied; the K1 stays estimated.
- por-9912-carrera: Porsche Cars North America's 2017 Carrera, 2017 Targa 4/4S and 2018 GTS sheets give the 991.2 3.0 as
  91.0 x 76.0 mm (2,966 cc, -0.5 %, inside the check) while the 2020 992 sheets give 91.0 x 76.4 (2,981 cc, the
  presets' figure); the same 2017 sheet calls one 3.0 a 3.8 l. Treated as a likely misprint and not applied to the three
  991.2 Carrera presets (still estimated) although it passes the check; the owner may decide otherwise.
- gm-ls3-camaro: the 2010-15 Camaro SS manual (LS3) preset has its own 103 x 92; Chevrolet gives 103.25 x 92. Left as it
  is (apply.js never overwrites a preset's own figures); a one-line change if the owner agrees.
- gm-lt2-veh-cc: the 2020+ Corvette C8 Stingray (LT2) preset gives 6,144 cc where the LT2 engine preset has 6,162; it
  took WardsAuto's 103.3 x 92.0 (within 0.4 %), the displacement is left for the owner. The engine-only LT2 preset keeps
  its own 103.25 x 92.
- Close to the limit but inside it, noted in the entries: the 1970 Buick 455 (4.3 x 3.9 in, rounded on the sheet,
  -0.42 %), the 1968-70 428 Cobra Jet (-0.35 %), the 2022 Low Rider S family M8 117 (+0.21 %). Ford's 2024 Ranger
  Raptor sheet states 2,949 cc for a bore and stroke whose product is 2,956.

### Still estimated, and why

171 car-list and 17 motorcycle four-stroke presets. By family: the GM V6 and four-cylinder engines (LFX, LGX, LLT, LF3,
LF4, LGY, LTG, LNF, LSJ, L67) and the remaining Gen I-IV V8s (L98, L69, LB9, L82, LT4 Gen II, LT5 Gen V, LM7, LQ4, L83,
LS4): no GM sheet or magazine table naming them was reached. Ford: the 4.6 2V and 4V Modular, the 5.4 3V, the 5.8 Trinity,
the 2.3 Lima, the 2.3 EcoBoost RS, the 1.6 EcoBoost, the 4.0 Cologne, the Barra sixes, the 2011-14 Coyote, the Boss 302
RoadRunner, the 428 Police Interceptor and the GTD's 5.2 (Ford's older media sheets were not found or refused).
Stellantis: the Hurricane sixes, the Viper 8.0/8.3/8.4, the SRT-4 and Caliber turbos, the Prowler 3.5 (the media pages
reached give no bore and stroke). Japan: the Lotus-installed Toyota 2ZZ and 2GR, the 2JZ-GE, 1UZ, 3UZ, 3S-GTE and LFA
V10, the Nissan RB26, SR20DE, KA24, VG30, the Mitsubishi 4B11 and 6G72, the NA Miata engines, the Honda B16 and K24A8
(maker catalogs found give the cc but not the bore and stroke, or refused). Europe: the 991.1 and 991.2 GT3/RS/GT2 RS
and the 993 GT2, 964 RS, 996.1 GT3 (no Porsche sheet with the figures found; 991.2 Carrera parked above), the 488 / F8 /
Pista, 430 Scuderia, F355, LaFerrari, the Huracán EVO / STO / LP580-2, Murciélago 6.2, Urus, the BMW S38 and S50B30US,
the X5 M S63, the Jaguar, Aston Martin, Alfa, Fiat, Mini and Hyundai-Kia presets, and the Mk6 GTI's EA888 Gen 1.
Motorcycles: the six MV Agustas, both Moto Guzzis, the 2001 GSX-R1000 (parked), the 2005-06 ZX-6R, the Tuono 1000 R,
TL1000S, Bandit 1250, Speed Triple 1050 RS, the 790 Bonneville, the Vitpilen 401 and the Himalayan 450. Each is one
search away from a usable sheet; nothing in this round suggested any of them is wrong.

### Changes to the tools and tests

- apply.js: a preset given only the source on one run (its own figures agreeing with the source to 0.06 mm) kept its
  own figures on that run but would have had them replaced by the source's on the next, so a second run was not
  idempotent (found on the LT2 engine preset, 103.25 against WardsAuto's 103.3). It now keeps them on every run; and
  `--check` lists each line it would change ("WOULD CHANGE id: preset"). A finding whose every target failed the check
  is kept in `review` only, not as an engine entry.
- presetdata_ui.js: floors raised to the new counts (source entries >= 80 -> >= 263, preset entries with bore and stroke
  >= 550 -> >= 826, presets with their own bore-and-stroke source >= 150 -> >= 428); the estimated example on the
  4-Stroke tab is now the Boss 429, as the Boss 302 is sourced. No test pins a result number for a preset whose bore and
  stroke changed in this round; no numeric pin moved.
- Verification: `apply.js --check` reports 0 lines to change; presetdata_ui, kseries_ui, motor_ui and ui_ui pass. Eight
  entries drawn at random (fer-360, ford-30eb-bronco, vw-ea888g3-gti, lam-gallardo-50, ford-20eb-st, mcl-m838t,
  duc-scrambler800, nis-qr25-sentra) were fetched again and their figures match research.json.

### The round-two entries

| Entry | Bore x stroke (mm) | Other fields | Quality | Source | Presets |
|---|---|---|---|---|---:|
| apr-rsv4-1100 | 81 x 53.32 |  | magazine test | https://www.motorcycle.com/specs/aprilia/sport/2021/rsv4/1100/detail.html | 1 |
| apr-tuareg660-22 | 81 x 63.9 |  | magazine test | https://www.motorcycle.com/specs/aprilia/on-off-road/2022/tuareg/660/detail.html | 1 |
| apr-tuono-v4-1100 | 81 x 52.3 |  | magazine test | https://www.motorcycle.com/specs/aprilia/sport/2021/tuono-v4/1100/detail.html | 1 |
| audi-25tfsi-8v-ttrs | 82.5 x 92.8 |  | maker data | https://www.audi-mediacenter.com/en/the-audi-tt-rs-2924/engine-2938 | 2 |
| audi-r8-v10-09 | 84.5 x 92.8 | CR 12.5, redline 8700 | maker data | https://www.audi-mediacenter.com/en/the-audi-r8-5-dot-2-fsi-quattro-2559/engine-2602 | 1 |
| audi-r8-v10plus-12 | 84.5 x 92.8 |  | maker data | https://www.audi-mediacenter.com/en/the-audi-r8-5-dot-2-fsi-quattro-2559/engine-2602 | 1 |
| audi-rs3-8p | 82.5 x 92.8 | CR 10 | maker data | https://www.audi.de/dam/nemo/customer-area/more-information/predecessor-models/a3/rs-3-sportback/Audi-RS3---2.5-TFSI-250-kW-S-tronic-SB-RS-Modell-2011.pdf | 1 |
| bmw-b58-m340i | 82 x 94.6 | CR 10.2 | maker data | https://www.press.bmwgroup.com/spain/article/attachment/T0302174ES/440751 | 1 |
| bmw-b58-other | 82 x 94.6 |  | maker data | https://www.press.bmwgroup.com/spain/article/attachment/T0302174ES/440751 | 3 |
| bmw-f900r | 86 x 77 |  | maker data | https://www.bmwmotorcycles.com/en/models/roadster/f900r/technicaldata.html | 1 |
| bmw-m1000r | 80 x 49.7 | CR 13.3 | maker data | https://www.bmw-motorrad.co.uk/en/models/m/m1000r-2023/technicaldata.html | 1 |
| bmw-m1000rr | 80 x 49.7 |  | maker data | https://www.bmwmotorcycles.com/en/models/m/m1000rr/technicaldata.html | 1 |
| bmw-n55 | 84 x 89.6 |  | magazine test | https://www.wardsauto.com/news/archive-wards-bmw-makes-n55-engine-new-again/789001/ | 2 |
| bmw-n55-m2 | 84 x 89.6 |  | maker data | https://www.press.bmwgroup.com/canada/article/attachment/T0261910EN/381940 | 1 |
| bmw-s1000rr-19 | 80 x 49.7 |  | magazine test | https://www.motorcycle.com/specs/bmw/sport/2019/s/1000-rr/detail.html | 1 |
| bmw-s14b23 | 93.4 x 84 |  | magazine test | https://www.fastcar.co.uk/tuning-tech-guides/bmw-m3-engines-guide-from-s14-to-s58/ | 1 |
| bmw-s50b32 | 86.4 x 91 |  | magazine test | https://www.fastcar.co.uk/tuning-tech-guides/bmw-m3-engines-guide-from-s14-to-s58/ | 2 |
| bmw-s52 | 86.4 x 89.6 |  | magazine test | https://www.fastcar.co.uk/tuning-tech-guides/bmw-m3-engines-guide-from-s14-to-s58/ | 3 |
| bmw-s54 | 87 x 91 |  | magazine test | https://www.fastcar.co.uk/tuning-tech-guides/bmw-m3-engines-guide-from-s14-to-s58/ | 4 |
| bmw-s63t0-m5 | 89 x 88.3 | CR 10, 4 valves | maker data | https://www.press.bmwgroup.com/global/article/attachment/T0122682EN/178942 | 1 |
| bmw-s63t0-other | 89 x 88.3 |  | maker data | https://www.press.bmwgroup.com/global/article/attachment/T0122682EN/178942 | 2 |
| bui-38t-86 | 96.52 x 86.36 | CR 8.5 | magazine test | https://over-drive-magazine.com/2022/12/05/1986-buick-g-body-rwd-cars-fact-sheet/ | 1 |
| bui-38t-87 | 96.52 x 86.36 | CR 8.5 | magazine test | https://over-drive-magazine.com/2022/12/06/1987-buick-regal-rwd-cars-fact-sheet/ | 2 |
| bui-38t-gen | 96.52 x 86.36 |  | magazine test | https://over-drive-magazine.com/2022/12/06/1987-buick-regal-rwd-cars-fact-sheet/ | 1 |
| bui-455-70 | 109.22 x 99.06 | CR 10 | magazine test | https://over-drive-magazine.com/2022/12/06/1970-buick-mid-size-car-fact-sheet/ | 1 |
| duc-1199 | 112 x 60.8 |  | magazine test | https://www.motorcycle.com/specs/ducati/sport/2013/panigale/1199/detail.html | 1 |
| duc-937-desertx | 94 x 67.5 |  | magazine test | https://www.motorcycle.com/specs/ducati/on-off-road/2023/desertx/937/detail.html | 2 |
| duc-hyper821 | 88 x 67.5 |  | magazine test | https://www.motorcycle.com/specs/ducati/sport/2013/hypermotard/821/detail.html | 1 |
| duc-multi-v4s-21 | 83 x 53.5 | CR 14 | magazine test | https://www.motorcycle.com/specs/ducati/sport/2021/multistrada/v4-s/detail.html | 1 |
| duc-panv4 | 81 x 53.5 |  | maker data | https://www.ducati.com/us/en/bikes/panigale/panigale-v4/engine | 1 |
| duc-scrambler800 | 88 x 66 |  | maker data | https://media.ducati.com/dam/MY19%20Ducati%20Scrambler%20Tech%20Spec%20ENG_UC67331.pdf | 1 |
| fer-296 | 88 x 82 |  | magazine test | https://www.km77.com/coches/ferrari/296/2022/coupe/estandar/296-gtb/datos | 1 |
| fer-360 | 85 x 79 |  | magazine test | https://www.km77.com/coches/ferrari/360/1999/coupe/estandar/360-modena/datos | 2 |
| fer-458 | 94 x 81 |  | magazine test | https://www.km77.com/coches/ferrari/458-italia/2010/coupe/estandar/458-italia2/datos | 2 |
| fer-812c | 94 x 78 |  | magazine test | https://www.km77.com/coches/ferrari/812/2017/berlinetta/competizione/812-competizione/datos | 1 |
| ford-20eb-st | 87.5 x 83.1 |  | maker data | https://media.ford.com/content/dam/fordmedia/Europe/de/2015/01/FocusST-Technische_Daten.pdf | 2 |
| ford-289hipo | 101.6 x 72.9 |  | magazine test | https://over-drive-magazine.com/2022/10/21/the-hi-po-289-cid-v-8-and-shelbys-mods/ | 1 |
| ford-30eb-bronco | 85.4 x 86 | CR 10.5, 4 valves | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2022/specs/2022-Ford-Bronco-Raptor-Technical-Specifications.pdf | 1 |
| ford-30eb-other | 85.4 x 86 |  | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2022/specs/2022-Ford-Bronco-Raptor-Technical-Specifications.pdf | 2 |
| ford-30eb-ranger | 85.4 x 86 | CR 10.5 | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2024/specs/2024-Ford-Ranger-Raptor-Technical-Specs.pdf | 1 |
| ford-428cj-69 | 104.9 x 101.09 |  | magazine test | https://over-drive-magazine.com/2023/11/10/1969-ford-mustang-fact-sheet | 1 |
| ford-46-3v-05 | 90.2 x 90 | CR 9.8 | magazine test | https://wardsauto.com/news-analysis/ford-46l-sohc-v-8 | 1 |
| ford-46-3v-other | 90.2 x 90 |  | magazine test | https://wardsauto.com/news-analysis/ford-46l-sohc-v-8 | 3 |
| ford-50ho-windsor | 101.6 x 76.2 |  | maker data | https://laundry.manualsonline.com/manuals/mfg/ford/m6007f50.html?p=2 | 8 |
| ford-54sc-07 | 90.2 x 105.8 |  | magazine test | https://www.racecar.com/news/13411/motorsport/shelby-gt500-rated-at-500-horsepower | 2 |
| ford-54sc-other | 90.2 x 105.8 |  | magazine test | https://www.racecar.com/news/13411/motorsport/shelby-gt500-rated-at-500-horsepower | 3 |
| ford-boss302-69 | 101.6 x 76.2 |  | magazine test | https://over-drive-magazine.com/2023/11/10/1969-ford-mustang-fact-sheet | 1 |
| ford-godzilla-crate | 107.2 x 101 | CR 10.5 | maker data | https://performanceparts.ford.com/part/M-6007-73 | 1 |
| ford-godzilla-sd | 107.2 x 101 |  | maker data | https://performanceparts.ford.com/part/M-6007-73 | 1 |
| ford-gt-35-17 | 92.51 x 86.7 | CR 9 | maker data | https://media.ford.com/content/dam/fordmedia/Europe/en/2017/05/gt_technical_specs_EU.PDF | 1 |
| ford-gt-35-20 | 92.51 x 86.7 |  | maker data | https://media.ford.com/content/dam/fordmedia/Europe/en/2017/05/gt_technical_specs_EU.PDF | 1 |
| ford-predator-gen | 93.98 x 92.96 |  | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2023/specs/2023-Ford-F-150-Raptor-R-Technical-Specifications.pdf | 1 |
| ford-predator-gt500 | 94 x 93 | CR 9.5, redline 7500 | reputable vendor | https://www.cjponyparts.com/resources/news/2020-shelby-gt500 | 1 |
| ford-predator-rr | 93.98 x 92.96 | CR 9.5, 4 valves | maker data | https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2023/specs/2023-Ford-F-150-Raptor-R-Technical-Specifications.pdf | 2 |
| ford-voodoo | 94 x 93 | CR 12, 4 valves | maker data | https://media.ford.com/content/dam/fordmedia/North%20America/US/2015/08/24/gt350-gt350r-tech-specs.pdf | 2 |
| gm-l48-350 | 101.6 x 88.39 |  | magazine test | https://over-drive-magazine.com/2024/03/28/1969-chevrolet-camaro-fact-sheet | 1 |
| gm-l71-427-67 | 107.95 x 95.5 | CR 11 | magazine test | https://over-drive-magazine.com/2024/12/30/1967-corvette-fact-sheet/ | 1 |
| gm-l72-427-69 | 107.95 x 95.5 | CR 11 | magazine test | https://over-drive-magazine.com/2024/03/28/1969-chevrolet-camaro-fact-sheet | 1 |
| gm-l78-396 | 103.99 x 95.5 |  | magazine test | https://over-drive-magazine.com/2024/03/28/1969-chevrolet-camaro-fact-sheet | 1 |
| gm-l88-427 | 107.95 x 95.5 |  | magazine test | https://over-drive-magazine.com/2024/12/30/1967-corvette-fact-sheet/ | 1 |
| gm-lq9 | 101.6 x 91.95 |  | magazine test | https://www.streetmachine.com.au/?p=55378 | 2 |
| gm-ls1 | 99.06 x 91.95 |  | magazine test | https://www.streetmachine.com.au/?p=55378 | 8 |
| gm-ls2 | 101.6 x 92 |  | magazine test | https://www.streetmachine.com.au/features/ls-engine-variants-part-two-generation-iv | 3 |
| gm-ls3 | 103.25 x 92 |  | maker data | https://chevrolet.com/performance/crate-engines/ls3 | 3 |
| gm-ls5-454-70 | 107.95 x 101.6 | CR 10.25 | magazine test | https://over-drive-magazine.com/2025/04/04/1970-corvette-fact-sheet/ | 1 |
| gm-ls6 | 99.06 x 91.95 |  | magazine test | https://www.streetmachine.com.au/?p=55378 | 3 |
| gm-ls6-454-70v | 107.95 x 101.6 |  | magazine test | https://over-drive-magazine.com/2025/06/20/1971-corvette-fact-sheet/ | 1 |
| gm-ls6-454-71 | 107.95 x 101.6 | CR 9 | magazine test | https://over-drive-magazine.com/2025/06/20/1971-corvette-fact-sheet/ | 1 |
| gm-ls7 | 104.8 x 101.6 |  | reputable vendor | https://www.jegs.com/i/Chevrolet-Performance/809/19329246/10002/-1 | 3 |
| gm-ls9 | 103.25 x 92 |  | magazine test | https://www.lsxmag.com/?p=16816 | 2 |
| gm-lsa | 103.25 x 92 |  | maker data | https://www.gmspecialtyvehicles.com/chevrolet/performance/engines/lsa | 3 |
| gm-lt1-350-70 | 101.6 x 88.39 | CR 11 | magazine test | https://over-drive-magazine.com/2025/04/04/1970-corvette-fact-sheet/ | 1 |
| gm-lt1-350-72 | 101.6 x 88.39 |  | magazine test | https://over-drive-magazine.com/2025/04/04/1970-corvette-fact-sheet/ | 1 |
| gm-lt1-gen2 | 101.6 x 88.39 |  | magazine test | https://hagerty.com/media/maintenance-and-tech/ls-lt-encyclopedia-modern-gm-small-block-v-8s-part-1 | 3 |
| gm-lt2 | 103.3 x 92 |  | magazine test | https://www.wardsauto.com/news/archive-wards-c8-corvette-s-small-but-mighty-lt2-v-8/793805/ | 1 |
| gm-lt5-zr1 | 99.06 x 92.96 |  | magazine test | https://www.lsxmag.com/?p=3813 | 2 |
| gm-lt7 | 104.25 x 80 |  | magazine test | https://www.streetmachine.com.au/features/c8-zr1-corvette-1064hp-quad-cam-twin-turbo-lt7-v8 | 2 |
| gm-z28-302 | 101.65 x 76.2 |  | magazine test | https://over-drive-magazine.com/2024/03/28/1969-chevrolet-camaro-fact-sheet | 1 |
| gm-zl1-427-69 | 107.95 x 95.5 | CR 11 | magazine test | https://over-drive-magazine.com/2024/03/28/1969-chevrolet-camaro-fact-sheet | 1 |
| hd-m8-107 | 100 x 111.13 |  | magazine test | https://www.motorcycle.com/manufacturer/harley-davidson/2017-harley-davidson-milwaukee-eight-engines-tech-brief.html | 1 |
| hd-m8-117-22 | 103.6 x 114.3 | CR 10.2 | magazine test | https://www.motorcycle.com/specs/harley-davidson/cruiser/2022/softail/low-rider-s/detail.html | 1 |
| hd-m8-117-other | 103.6 x 114.3 |  | magazine test | https://www.motorcycle.com/specs/harley-davidson/cruiser/2022/softail/low-rider-s/detail.html | 3 |
| hd-revmax1250-22 | 104.9 x 72.4 |  | magazine test | https://www.motorcycle.com/specs/harley-davidson/standard/2022/sportster/s/detail.html | 1 |
| hon-cb650-20 | 67 x 46 |  | maker data | https://hondanews.com/en-US/powersports/releases/release-47ef5ef525f391ae783334075a031539-2020-honda-cb650r-specifications | 3 |
| hon-cbr1000rr-05 | 75 x 56.5 |  | maker data | https://hondanews.com/en-US/powersports/releases/release-7ce448ae6f61162d9aad27004c34c31d-2005-honda-cbr1000rr-specifications | 1 |
| hon-cbr1000rr-17 | 76 x 55 |  | maker data | https://hondanews.com/en-US/powersports/releases/release-78e5848b968e454588fa0e1bb9a1058a-2017-honda-cbr1000rr-specifications | 1 |
| hon-k20c1 | 86 x 85.9 |  | magazine test | https://www.km77.com/coches/honda/civic/2017/5-puertas/type-r-gt/civic-type-r-20-vtec-turbo-gt/datos | 1 |
| hon-rebel1100-21 | 92 x 81.5 | CR 10.1 | magazine test | https://www.motorcycle.com/specs/honda/cruiser/2021/rebel-1100/base/detail.html | 1 |
| hon-transalp-24 | 87 x 63.5 | CR 11 | maker data | https://hondanews.com/en-US/powersports/releases/release-cc39196e84787a20ec3cb086fb11a917-2024-honda-xl750-transalp-specifications | 1 |
| kaw-h2 | 76 x 55 |  | maker data | https://www.kawasaki.com/en-us/products/ProductSpecSheetPDF/2025-ninja-h2-abs | 1 |
| kaw-w800-19 | 77 x 83 | CR 8.4 | maker data | https://www.kawasaki.com/en-us/products/ProductSpecSheetPDF/2019-w800-cafe | 1 |
| kaw-zx10r-17 | 76 x 55 |  | magazine test | https://www.motorcycle.com/specs/kawasaki/sport/2017/ninja-zx-10r/base/detail.html | 1 |
| kaw-zx4rr-23 | 57 x 39.1 | CR 12.3 | maker data | https://kawasaki.com/en-us/products/ProductSpecSheetPDF/2023-ninja-zx-4rr-krt-edition | 1 |
| kaw-zx6r-636-20 | 67 x 45.1 |  | maker data | https://hawaii.kawasaki.com/en-us/products/ProductSpecSheetPDF/2020-ninja-zx-6r-abs | 2 |
| ktm-1290sdr-15 | 108 x 71 |  | magazine test | https://www.motorcycle.com/specs/ktm/sport/2015/super-duke/1290-r-abs/detail.html | 1 |
| ktm-890adv | 90.7 x 68.8 |  | magazine test | https://www.motorcycle.com/specs/ktm/on-off-road/2021/adventure/890-r/detail.html | 2 |
| lam-aventador-700 | 95 x 76.4 |  | magazine test | https://www.km77.com/coches/lamborghini/aventador/2012/coupe/estandar/aventador-lp-700-42/datos | 1 |
| lam-aventador-svj | 95 x 76.4 |  | magazine test | https://www.km77.com/coches/lamborghini/aventador/2012/coupe/svj/aventador-svj/datos | 1 |
| lam-gallardo-50 | 82.5 x 92.8 |  | magazine test | https://www.km77.com/coches/lamborghini/gallardo/2005/coupe/estandar/gallardo-coupe/datos | 1 |
| lam-gallardo-560 | 84.5 x 92.8 |  | magazine test | https://www.km77.com/coches/lamborghini/gallardo/2005/coupe/estandar/gallardo-lp560-4-coupe2/datos | 1 |
| lam-gallardo-570 | 84.5 x 92.8 |  | magazine test | https://www.km77.com/coches/lamborghini/gallardo/2005/coupe/edizione-tecnica/gallardo-lp570-4-superleggera-edizione-tecnica-coupe/datos | 1 |
| lam-huracan-610 | 84.5 x 92.8 |  | magazine test | https://www.km77.com/coches/lamborghini/huracan/2014/coupe/estandar/huracan-lp-610-4/datos | 1 |
| lam-huracan-640 | 84.5 x 92.8 |  | magazine test | https://www.km77.com/coches/lamborghini/huracan/2014/coupe/performante/huracan-performante/datos | 1 |
| lam-murcielago-640 | 88 x 89 |  | magazine test | https://www.km77.com/coches/lamborghini/murcielago/2008/coupe/lp-640/murcielago-lp-640-coupe/datos | 2 |
| maz-mzr20-nc | 87.5 x 83.1 |  | magazine test | https://www.km77.com/coches/mazda/mx-5/2009/roadster-coupe/sportive/mx-5-20-sportive-roadster-coupe/datos | 1 |
| maz-skyg20-nd2 | 83.5 x 91.2 |  | magazine test | https://www.km77.com/coches/mazda/mx-5/2019/roadster/nappa-edition/mx-5-20-skyactiv-g-135-kw-184-cv-i-stop-i-eloop-nappa-edition/datos | 1 |
| mb-m113k | 97 x 92 |  | maker data | https://mercedes-benz-publicarchive.com/marsClassic/en/instance/ko/E-55-AMG--W-211-E-55-2002---2006.xhtml?oid=5375 | 2 |
| mb-m139 | 83 x 92 |  | magazine test | https://www.km77.com/coches/mercedes/tecnica/2019/informacion | 2 |
| mb-m159 | 102.2 x 94.6 |  | maker data | https://tv.manualsonline.com/manuals/mfg/mercedesbenz/2011_sls_amg.html?p=424 | 4 |
| mb-m276-c43 | 88 x 82.1 |  | maker data | https://media.mbusa.com/releases/release-f64df5efcf40bb28fb4d418ddc1c7aba-2018-mercedes-amg-c43-sedan | 1 |
| mcl-m838t | 93 x 69.9 |  | magazine test | https://www.km77.com/coches/mclaren/mp4-12c/2013/spider/estandar/mp4-12c-spider/datos | 5 |
| mcl-m840t | 93 x 73.5 |  | magazine test | https://www.km77.com/coches/mclaren/super-series/2017/coupe/lt/765lt/datos | 3 |
| mit-4g63-evo9 | 85 x 88 |  | reputable vendor | https://www.goo-net-exchange.com/catalog/MITSUBISHI__LANCER/10026565 | 2 |
| moP-426hemi-70 | 107.95 x 95.25 | CR 10.2 | magazine test | https://over-drive-magazine.com/2024/04/18/1970-plymouth-barracuda-fact-sheet | 1 |
| moP-440-68charger | 109.73 x 95.25 | CR 10.1 | magazine test | https://over-drive-magazine.com/2024/06/19/1968-dodge-mid-size-cars-fact-sheet/ | 1 |
| moP-440-6bbl | 109.73 x 95.25 |  | magazine test | https://over-drive-magazine.com/2024/04/18/1970-plymouth-barracuda-fact-sheet | 1 |
| nis-qr25-sentra | 89 x 100 |  | maker data | https://canada.nissannews.com/en-CA/releases/ca-2011-nissan-sentra-se-r | 2 |
| nis-sr20det-s15 | 86 x 86 |  | reputable vendor | https://www.goo-net-exchange.com/catalog/NISSAN__SILVIA/1502004 | 2 |
| nis-vq35de-03 | 95.5 x 81.4 |  | maker data | https://www.manualowl.com/am/Nissan/2003-350Z/Manual/861?page=203 | 2 |
| nis-vq35de-05 | 95.5 x 81.4 |  | maker data | https://www.manualowl.com/am/Nissan/2005-350Z/Manual/879?page=251 | 1 |
| nis-vq35hr-08 | 95.5 x 81.4 |  | maker data | https://www.manualowl.com/am/Nissan/2008-350Z/Manual/912?page=282 | 2 |
| nis-vr30 | 86 x 86 |  | maker data | https://canada.infinitinews.com/en-CA/releases/release-5ac4eb09db8c0dedca705b2277000fa3-2023-infiniti-q50-specifications | 3 |
| pon-400-ra4-69 | 104.65 x 95.25 | CR 10.75 | magazine test | https://over-drive-magazine.com/2023/03/09/1969-pontiac-mid-size-cars-fact-sheet/ | 1 |
| por-718-gt4 | 102 x 81.5 | CR 13, redline 8000 | maker data | https://download.newsroom.porsche.com/dam/jcr:9d46f6de-fbb6-42d8-b474-7295ec4e7e96/PAG_718_Cayman_GT4_EN.pdf | 1 |
| por-964-carrera | 100 x 76.4 |  | magazine test | https://www.excellence-mag.com/resources/specs/291 | 2 |
| por-964-turbo33 | 97 x 74.4 |  | magazine test | https://www.excellence-mag.com/resources/specs/307 | 1 |
| por-964-turbo36 | 100 x 76.4 |  | magazine test | https://www.excellence-mag.com/resources/specs/309 | 1 |
| por-991-carrera34 | 97 x 77.5 | CR 12.5, redline 7800 | maker data | https://newsroom.porsche.com:443/dam/jcr:e1638451-d7dc-4f0e-a00d-b169cf342b86/2013_911_Technical_Specifications.pdf.PDF | 1 |
| por-991-carreras38 | 102 x 77.5 | CR 12.5, redline 7800 | maker data | https://newsroom.porsche.com:443/dam/jcr:e1638451-d7dc-4f0e-a00d-b169cf342b86/2013_911_Technical_Specifications.pdf.PDF | 1 |
| por-991-gts38 | 102 x 77.5 |  | maker data | https://newsroom.porsche.com:443/dam/jcr:e1638451-d7dc-4f0e-a00d-b169cf342b86/2013_911_Technical_Specifications.pdf.PDF | 1 |
| por-9911-turbo | 102 x 77.5 |  | maker data | https://newsroom.porsche.com:443/dam/jcr:71ee7b5f-5fe9-4f45-bc6a-3cfdf18b51d5/2017_911_Turbo_Technical_Specifications.pdf.PDF | 2 |
| por-9912-gt3-other | 102 x 81.5 |  | maker data | https://newsroom.porsche.com:443/dam/jcr:e00c2789-42c7-4dab-a818-a732003194b0/2019_911_GT3_RS_Technical_Specifications.pdf.PDF | 3 |
| por-9912-gt3rs | 102 x 81.5 | CR 13.3, redline 9000 | maker data | https://newsroom.porsche.com:443/dam/jcr:e00c2789-42c7-4dab-a818-a732003194b0/2019_911_GT3_RS_Technical_Specifications.pdf.PDF | 1 |
| por-9912-turbo | 102 x 77.5 | CR 9.8, redline 7000 | maker data | https://newsroom.porsche.com:443/dam/jcr:71ee7b5f-5fe9-4f45-bc6a-3cfdf18b51d5/2017_911_Turbo_Technical_Specifications.pdf.PDF | 1 |
| por-9912-turbos | 102 x 77.5 | CR 9.8, redline 7200 | maker data | https://newsroom.porsche.com:443/dam/jcr:71ee7b5f-5fe9-4f45-bc6a-3cfdf18b51d5/2017_911_Turbo_Technical_Specifications.pdf.PDF | 1 |
| por-992-carrera-other | 91 x 76.4 |  | maker data | https://newsroom.porsche.com:443/dam/jcr:d5712d5c-b376-41d9-8201-09731162e143/2020_911_Carrera_S_and_911_Carrera_4S_US_specifications.pdf.PDF | 3 |
| por-992-carreras | 91 x 76.4 | CR 10.2, redline 7500 | maker data | https://newsroom.porsche.com:443/dam/jcr:d5712d5c-b376-41d9-8201-09731162e143/2020_911_Carrera_S_and_911_Carrera_4S_US_specifications.pdf.PDF | 1 |
| por-992-turbo | 102 x 76.4 |  | maker data | https://download.newsroom.porsche.com/dam/jcr:8b531ae3-48f0-4d00-bfb9-c29f2676959b/Copy%20of%20U.S.%20Technical%20Specifications%202021%20911%20Turbo%20S%20Coupe%20and%20Cabriolet.pdf | 1 |
| por-992-turbos | 102 x 76.4 | CR 8.7, redline 7200 | maker data | https://download.newsroom.porsche.com/dam/jcr:8b531ae3-48f0-4d00-bfb9-c29f2676959b/Copy%20of%20U.S.%20Technical%20Specifications%202021%20911%20Turbo%20S%20Coupe%20and%20Cabriolet.pdf | 1 |
| por-9922-gt3 | 102 x 81.5 |  | maker data | https://media.porsche.com/mediakit/911-gt3-touring-package/specifications/pdk/PAG-992-911GT3-TP-PDK-WLTP-EN.pdf | 1 |
| por-996-carrera34 | 96 x 78 |  | magazine test | https://www.excellence-mag.com/resources/specs/57 | 1 |
| por-996-carrera36 | 96 x 82.8 |  | magazine test | https://www.excellence-mag.com/resources/specs/63 | 1 |
| por-996-gt2 | 100 x 76.4 |  | magazine test | https://www.excellence-mag.com/resources/specs/80 | 1 |
| por-996-gt3-04 | 100 x 76.4 |  | magazine test | https://www.excellence-mag.com/resources/specs/82 | 1 |
| por-996-turbo | 100 x 76.4 |  | magazine test | https://www.excellence-mag.com/resources/specs/72 | 3 |
| por-997-gt2rs | 100 x 76.4 |  | magazine test | https://excellence-mag.com/resources/specs/175 | 1 |
| sub-ej257-06 | 99.5 x 79 |  | magazine test | https://www.km77.com/coches/subaru/impreza/2006/4-puertas/wrx/impreza-sedan-25-wrx-sti/datos | 2 |
| sub-ej257-15 | 99.5 x 79 |  | magazine test | https://www.km77.com/coches/subaru/wrx/2015/4-puertas/confort-edition/wrx-sti-25-sedan-confort-edition/datos | 1 |
| suz-busa-1g | 81 x 63 |  | magazine test | https://www.motorcycle.com/specs/suzuki/sport/2005/hayabusa/1300r/detail.html | 1 |
| suz-busa-2g | 81 x 65 |  | magazine test | https://www.totalmotorcycle.com/photos/2008models/2008models-Suzuki-HayabusaGSX1300R.htm | 1 |
| suz-gsx8r-24 | 84 x 70 | CR 12.8 | maker data | https://suzukicycles.com/street/2024/gsx-8r | 1 |
| suz-gsx8s-23 | 84 x 70 | CR 12.8 | magazine test | https://www.motorcycle.com/specs/suzuki/standard/2023/gsx-s/8s/detail.html | 1 |
| suz-gsxr1000r-17 | 76 x 55.1 |  | magazine test | https://www.motorcycle.com/specs/suzuki/sport/2017/gsx-r/1000r/detail.html | 1 |
| suz-gsxr600-23 | 67 x 42.5 | CR 12.9 | maker data | https://suzukicycles.com/sportbike/2023/gsx-r600 | 1 |
| suz-gsxr750-22 | 70 x 48.7 | CR 12.5 | maker data | https://www.globalsuzuki.com/motorcycle/smgs/products/2022gsx-r750/ | 1 |
| suz-gsxr750-k4 | 72 x 46 |  | magazine test | https://cdn-fastly.motorcycle.com/specs/suzuki/sport/2004/gsx-r/750/detail.html | 1 |
| suz-gsxr750-k9 | 70 x 48.7 |  | magazine test | https://www.totalmotorcycle.com/photos/2009models/2009-Suzuki-GSX-R750 | 1 |
| tri-daytona660 | 74.04 x 51.1 |  | maker data | https://www.triumphmotorcycles.com/motorcycles/sport/daytona-660/specification | 1 |
| tri-daytona675-13 | 76 x 49.6 |  | magazine test | https://www.motorcycle.com/specs/triumph/sport/2013/daytona/675/detail.html | 1 |
| tri-speed400-24 | 89 x 64 | CR 12 | maker data | https://www.triumphmotorcycles.com/motorcycles/classic/speed-400/speed-400-2024 | 1 |
| tri-speedtwin1200-24 | 97.6 x 80 | CR 12.1 | magazine test | https://www.motorcycle.com/specs/triumph/standard/2024/speed-twin-1200/base/detail.html | 1 |
| tri-st765r-24 | 78 x 53.4 | CR 13.25 | magazine test | https://www.motorcycle.com/specs/triumph/standard/2024/street-triple-765/r/detail.html | 1 |
| tri-t100-17 | 84.58 x 80.01 |  | magazine test | https://www.motorcycle.com/specs/triumph/standard/2017/bonneville-t100/base/detail.html | 1 |
| vw-18t | 81 x 86.4 |  | magazine test | https://www.km77.com/coches/volkswagen/golf/1997/3-puertas/gti/golf-3p-gti-18-t-180-cv-ed-especial/datos | 3 |
| vw-ea113-golfr | 82.5 x 92.8 |  | magazine test | https://www.km77.com/coches/volkswagen/golf/2009/3-puertas/r/golf-3p-r-20-tsi-270-cv-4motion2/datos | 2 |
| vw-ea113-gti | 82.5 x 92.8 |  | magazine test | https://www.km77.com/coches/volkswagen/golf/2004/3-puertas/gti/golf-3p-gti-tfsi-20-200-cv-6-vel/datos | 4 |
| vw-ea888g3-cs | 82.5 x 92.8 |  | magazine test | https://www.km77.com/coches/volkswagen/golf/2013/3-puertas/gti-clubsport/golf-3p-gti-clubsport/datos | 2 |
| vw-ea888g3-gti | 82.5 x 92.8 |  | magazine test | https://www.km77.com/coches/volkswagen/golf/2013/3-puertas/gti/golf-3p-gti-20-tsi-220-cv-bmt-dsg-6-vel/datos | 4 |
| vw-vr6-32-mk4 | 84 x 95.9 |  | magazine test | https://www.km77.com/coches/volkswagen/golf/1997/3-puertas/r32/golf-r32/datos | 1 |
| vw-vr6-32-mk5 | 84 x 95.9 |  | magazine test | https://www.km77.com/coches/volkswagen/golf/2004/3-puertas/r32/golf-3p-r32-32-v6-250-cv-4motion/datos | 2 |
| yam-r1-cp | 78 x 52.2 |  | magazine test | https://www.motorcycle.com/specs/yamaha/sport/2010/yzf/r1.html | 1 |
| yam-r6-06 | 67 x 42.5 |  | magazine test | https://www.totalmotorcycle.com/photos/2006models/2006models-Yamaha-YZF-R6 | 1 |
| yam-r6-17 | 67 x 42.5 |  | maker data | https://global.yamaha-motor.com/news/2016/1014/yzf-r6.html | 1 |
| yam-r7-24 | 80 x 68.6 | CR 11.5 | maker data | https://www.yamahamotorsports.com/models/24-yzf-r7/specs | 1 |
| yam-tracer9-21 | 78 x 62.1 | CR 11.5 | magazine test | https://www.motorcycle.com/specs/yamaha/sport-touring/2021/tracer/9-gt/detail.html | 1 |
