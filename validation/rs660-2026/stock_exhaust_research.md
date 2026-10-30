# Aprilia RS 660 (US MY2026 = Euro MY2025 engine) — stock exhaust & intake geometry research for a 1-D (OpenWAM) model

Research date: 2026-10-30. Web-only. Every number carries its URL. Anything I estimated is tagged **(est)** with the reasoning. Nothing is invented; where nothing could be found it says so and the item goes on the measurement list at the end.

Companion files in this folder:
- Photo of the complete removed 2020-24 stock system: Mivv fitting instructions (see §3.1 for the link; not copied here, it is their image).
- Photo of the 2021-22 stock headers and cat-box inlet: Austin Racing box-delete instructions (§3.1; not copied here).
- `epa_on-hwymc-2006-present.xlsx` — EPA highway-motorcycle certification database (source for §1.2).

---

## 0. Headline findings (read this first)

1. **Which engine is in a "2026 US" RS 660.** EPA certification data show the US model-year 2026 RS 660 is engine family **TPVMC0.65XGU**, application type "NEW", EDV = RS 660 VIN ZD4KSS005RS000144, rated **77.2 kW @ 10,400 rpm** — i.e. the updated 105 PS / Euro 5+ engine that Europe got for MY2025. The US MY2025 family (SPVMC0.65KSG) was still a carry-over of the 73.5 kW @ 10,500 rpm engine. Source: EPA spreadsheet https://www.epa.gov/system/files/documents/2026-03/on-hwymc-2006-present.xlsx (rows "TPVMC0.65XGU-004" and "SPVMC0.65KSG-011"; index page https://www.epa.gov/compliance-and-fuel-economy-data/annual-certification-data-vehicles-engines-and-equipment). SC-Project's Aprilia accessory kit for this engine is likewise listed as "E5+ from 2025 (USA from 2026)": https://www.aspecialparts.com/shop/exhaust-systems/aprilia-sc-project-street-legal-complete-exhaust-2s002397-for-rs660-and-tuono-660-e5-from-2025-usa-from-2026/
2. **Two of the owner's engine numbers are from the old engine.** For the 2025+ engine the manufacturer figures are **105 PS (77.2 kW) @ 10,400 rpm and 70 Nm @ 8,400 rpm** (not 105 hp @ 10,500 / 67 Nm @ 8,500, which mixes the new power with the 2020-24 torque figure). Sources: Aprilia India official spec sheet https://apriliaindia.com/images/rs-660/tech_specs.pdf ("105 HP (77.2 kW) @ 10,400 rpm", "70 Nm @ 8,400 rpm"); motorradonline https://www.motorradonline.de/supersportler/aprilia-rs-660-und-factory-neu-2025-mit-105-ps/ ("105 PS (77 kW) at 10,400/min and 70 Nm at 8,400/min"; previous "100 PS (73.5 kW) at 10,500/min and 67 Nm at 8,500/min"); motorcycle.com 2026 spec page https://www.motorcycle.com/specs/aprilia/sport/2026/rs-660/factory/detail.html (105 bhp @ 10,400; 70 Nm @ 8,400). EPA rated rpm for the 2026 family is also 10,400.
3. **Throttle bodies are 52 mm on this engine, not 48 mm.** 48 mm was 2020-24. Sources: Cycle News https://www.cyclenews.com/2025/03/article/aprilia-release-revised-rs-660-factory-now-with-105-hp-for-2025 ("4 mm larger 52 mm throttle bodies"); Rider https://ridermagazine.com/2024/12/16/2025-aprilia-rs-660-and-rs-660-factory-preview/ ("previous 48mm throttle bodies have been replaced with larger 52mm ones"); MCN https://motorcyclenews.com/news/new-bikes/2024/november/aprilia-rs660-standard-rs660-factory ("enlarged from 48mm to 52mm"); Insella spec table https://www.insella.it/primo_contatto/aprilia-rs-660-rs-660-factory-2025 ("Ø52 mm"); Motorbox https://www.motorbox.com/moto/magazine-moto/moto-novita/aprilia-rs-660-rs-660-factory-eicma-2024-tutte-le-novita ("52 mm al posto dei precedenti da 48 mm"). The 2020 owner's manual gives the old value: "Throttle body diameter 48 mm (1.89 in)" https://apriliasuperstore.com/pdf/179055.
4. **Stock exhaust architecture (sourced, see §3):** two separate stainless header pipes (one lambda probe each), each with a stepped/slip-joint section, running back under the engine into **one single underbelly box** that contains the single-bed three-way catalyst and the silencer; no exhaust flap/valve exists; secondary air injection (PAIR) into the ports. The Euro 5+/MY2025+ version adds a **post-catalyst lambda probe** (three probes total). Stock system mass ≈ 6.1–6.4 kg.
5. **No published pipe diameters, lengths, catalyst or silencer dimensions exist for the stock system.** Not in press kits, manuals, EPA/CARB data (CARB EOs for motorcycles do not list catalyst volume), aftermarket sites, or forums that I could reach. Everything dimensional in §4 is either an aftermarket reference point or an **(est)**, and the owner must measure (§6).

---

## 1. Engine and emissions data

### 1.1 Manufacturer / manual data

| Item | Value | Source |
|---|---|---|
| Layout | Parallel twin, 270° crankpin offset, DOHC, 4 valves/cyl, one counterbalancer | https://Motorcycle.com/features/everything-you-want-to-know-about-the-aprilia-rs660-except-what-its-like-to-ride.html ; https://www.speedweek.com/en/a/aprilia-rs-660-update-2027 |
| Bore × stroke | 81 × 63.93 mm | https://apriliaindia.com/images/rs-660/tech_specs.pdf |
| Displacement | 659 cc | same |
| Compression ratio | 13.5 ± 0.5 : 1 | owner's manual https://apriliasuperstore.com/pdf/179055 (p.180 "13.5 +/- 0.5: 1") |
| Power / torque (2025+ engine) | 105 PS (77.2 kW) @ 10,400 rpm; 70 Nm @ 8,400 rpm | https://apriliaindia.com/images/rs-660/tech_specs.pdf |
| Power / torque (2020-24 engine, for reference) | 100 PS (73.5 kW) @ 10,500; 67 Nm @ 8,500 | https://www.motorradonline.de/supersportler/aprilia-rs-660-und-factory-neu-2025-mit-105-ps/ |
| Idle speed | **1400 ± 100 rpm** (2020-24 manuals; no 2025 manual found online — verify on the dash/ECU) | owner's manual https://apriliasuperstore.com/pdf/179055 ("Idle engine speed 1400 +/- 100 rpm"); 2021 Service Station Manual excerpt https://manuals.plus/m/56a8c3a57e40262b784a845049181981d6935aa56217222bcfd6980ccb6d2b50_optim.pdf ("1400 +/- 100 rpm") |
| "Engine revs at maximum speed" | 10,500 ± 100 rpm (2020-24 manual); rev limiter quoted as 11,500 rpm at launch | https://apriliasuperstore.com/pdf/179055 ; https://moto.motorionline.com/en/aprilia-rs-660-sportiva-modello-design-tecnica-caratteristiche-informazioni/ ("limitatore ... 11.500 giri") |
| Valve clearances | intake 0.10–0.15 mm; exhaust 0.20–0.25 mm; bucket tappets, shims 1.75–3.15 mm | SSM excerpt https://manuals.plus/m/56a8c3a57e40262b784a845049181981d6935aa56217222bcfd6980ccb6d2b50_optim.pdf |
| Valve head diameters, lift, cam timing (IVO/IVC/EVO/EVC) | **NOT PUBLISHED** anywhere I could find (press kits, SSM excerpt, parts sites). OEM exhaust valve P/N 1A016659 is sold without dimensions: https://www.aspecialparts.com/shop/engine/spare-parts/exhaust-valve-1a016659-for-660-engines/ . Only qualitative: "hollowed-out camshafts", single timing chain | https://motorcyclenews.com/news/new-tech/aprilia-660-engine |
| Exhaust port / header flange | Exhaust manifold flange nuts M7 ×4 (two studs per port), 13 Nm. Port gasket is the Aprilia V4/660 "donut" gasket 2B012220 (= 852090); Lextek's replacement gasket for the RS660 is OD 45 mm / ID 36 mm / 4 mm thick → the port spigot bore is ≈36 mm at the gasket seat | SSM excerpt (above); gasket fitment https://www.apworkshops.co.uk/exhaust-gasket-v4.html ; dimensions https://www.lextekproducts.com/part/EXKT7431 ("GSKEX015 ... Outer diameter: 45mm, Inner diameter: 36mm") |
| Spark plug | NGK MR9DI-7 (iridium), gap 0.7–0.8 mm | SSM excerpt |
| Fuel system | Electronic injection, 1 injector/cyl, 2 motorised throttle bodies (ride-by-wire) "with fixed length intake trumpets. 1 dynamic air intake" | owner's manual https://apriliasuperstore.com/pdf/179055 (p.184) |
| Throttle body bore | **52 mm** (2025+); 48 mm (2020-24) | see §0 item 3 |
| Airbox | "Airbox with front dynamic air intake(s)", polyester filter. **Volume not published.** Gabro Racing's race airbox claims "+20 % volume downstream of the filter" without giving the stock value | 2024 press kit https://cdn.powergo.ca/media/document/2024/1/ce6da2cd65b74c9fb504fcd0e6214968/aprilia-rs-660-extrema-660-checkered-flag-2024-0.pdf ; https://www.aspecialparts.com/shop/grt-gabro-racing-team/evo-race-airbox-kit-for-aprilia-rs-and-tuono-660-by-gabro-racing |
| Intake runner / trumpet length | **Not published.** Motorcycle.com says the "differing-length intake manifold" is borrowed from the RSV4 (i.e. the two trumpets may differ from each other); the manual says "fixed length" (no variable-geometry stacks) | https://Motorcycle.com/features/everything-you-want-to-know-about-the-aprilia-rs660-except-what-its-like-to-ride.html ; https://apriliasuperstore.com/pdf/179055 |
| Primary / final drive | primary 39/80; gears 17/46, 16/33, 24/39, 19/26, 21/25, 22/23; final 17/43 | owner's manual https://apriliasuperstore.com/pdf/179055 |
| Tank | 15 L (3.5 L reserve) | same |
| Measured rear-wheel output, 2021 (old engine) | 88.81 hp @ 10,450 rpm, 45.34 lb-ft @ 8,530 rpm, Dynojet 250i | https://www.cycleworld.com/story/bikes/how-much-power-does-the-2021-aprilia-rs-660-make/ |
| Mivv rear-wheel baseline, 2020-21 stock | 85.60 hp @ 10,600 rpm, 59.80 Nm @ 8,600 rpm | https://mivv.com/en/product/a-014-ldrb-aprilia-rs-660-2020-2024/ |

### 1.2 EPA certification data (US MY2026 RS 660) — the only official emissions-hardware record found

Source: https://www.epa.gov/system/files/documents/2026-03/on-hwymc-2006-present.xlsx (sheet "Family Info"; local copy `epa_on-hwymc-2006-present.xlsx`).

| Field | MY2026 RS 660 / RS 660 Factory / Tuono 660 Factory | MY2025 RS 660 (carry-over old engine) |
|---|---|---|
| Engine family / certificate | TPVMC0.65XGU / TPVMC0.65XGU-004 | SPVMC0.65KSG / SPVMC0.65KSG-011 |
| Application type | NEW | CO (carry-over) |
| Fuel system | SFI, A/F feedback sensor: Y | same |
| Air injection | **PAIR** (pulsed secondary air) | PAIR |
| Catalyst | **"Three Way Catalyst (TWC), single-bed, closed-loop warm up"** (i.e. one substrate) | same |
| EGR / charge cooler | N / N | N / N |
| EDV | RS 660, VIN ZD4KSS005RS000144, engine code 0039723 (PROTO) | RS 660, ASB-04 (PROTO) |
| Rated power / rpm | 77.2 kW @ 10,400 | 73.5 kW @ 10,500 |
| Equivalent inertia mass / road-load force | 270 kg / 129.3 N | 280 kg / 131.4 N |
| N/V ratio | 45.7 | 45.7 |
| Cert levels (FTP, g/km) | CO 0.5; HC+NOx 0.1; CO2 109.8; CH4 0.007; N2O 0.012 | CO 0.3; HC+NOx 0.1; CO2 109.7 |

CARB: the MY2026 highway-motorcycle EO list shows Piaggio EO **M-048-0336** (4/25/2025) for family TPVMC0.65XGU, but CARB publishes no PDF and the EO would not contain catalyst volume anyway: https://ww2.arb.ca.gov/node/43206 . MY2025 list (SPVMC0.65KSG = EO M-048-0322): https://ww2.arb.ca.gov/new-vehicle-and-engine-certification-executive-orders-my2025-highway-motorcycles . **Catalyst volume / cell density is not in either EPA or CARB public data.**

---

## 2. What changed for Euro 5+ / MY2025 (relevant to the exhaust model)

- Throttle bodies 48 → 52 mm (§0).
- Power 100 → 105 PS, torque 67 → 70 Nm, peak rpm 10,500 → 10,400 (§0).
- Euro 5+ requires catalyst monitoring; multiple aftermarket makers confirm the 2025+ bike carries an **after-catalyst lambda probe** in addition to the two per-cylinder probes:
  - Mivv: "NOT COMPATIBLE WITH EURO5+ VEHICLES EQUIPPED WITH AFTER-CATALYST LAMBDA PROBE" https://mivv.com/en/product/a-014-ldrb-aprilia-rs-660-2020-2024/
  - Spark (2020-26 race header): "3 LAMBDA SENSOR SOCKETS ... compatible with Euro 5+ motorcycles" https://www.wrs.it/en/complete-exhaust-system/498905-complete-racing-exhaust-force-evo-titanium-spark-aprilia-rs-660-tuono-660-2020-2026.html
  - Akrapovič (S-A6R5-APLC, 2025+): "On Euro 5+ bikes with two lambda sensors, the engine check light may illuminate ... deviation in the original catalytic converter parameters" https://motoee.com/product/akrapovic-s-a6r5-aplc-racing-line-full-exhaust-system-for-aprilia-rs-660-tuono-660-2025/
  - SC-Project sells an OBD "Electronic Catalytic Remover" specifically for the 2025-26 bike https://motorcycleperformancestore.co.uk/collections/all/products/sc-project-electronic-catalytic-remover-aprilia-rs660-2025-26
- Aftermarket part numbers changed for 2025+ (SC-Project A23A → A23C; Akrapovič S-A6R4 → S-A6R5; Arrow 71755/71929 → 77008), which implies the stock system / mounting changed in some way, but **no source describes what physically changed** in the stock box, pipes or outlets. Spy shots of the 2027 facelift mention "a larger exhaust manifold" https://www.speedweek.com/en/a/aprilia-rs-660-update-2027 — not the 2025/26 bike.
- Secondary air (PAIR) is retained (EPA table above); block-off kits are sold for the 2025 bike https://www.omniaracing.net/en/jetprime-pair-circuit-elimination-kit-aprilia-rs660-2025-p-868759.html

---

## 3. Stock exhaust architecture (what is actually documented)

### 3.1 Layout

Evidence (all 2020-24 unless stated; the 2025+ system is believed to be of the same architecture plus the third lambda — unverified):

1. **Two separate header pipes**, bolted to the head with 4 nuts total (two studs per port, M7, 13 Nm): SSM excerpt https://manuals.plus/m/56a8c3a57e40262b784a845049181981d6935aa56217222bcfd6980ccb6d2b50_optim.pdf ; Spark instructions "Unscrew the 4 stock header bolts" https://www.spark.it/images/kit/gap8806_650195a6e0d7f.pdf ; Aprilia/SC-Project kit instructions: "remove the four nuts securing the two manifolds on the engine cylinder head" https://www.easyparts-rollerteile.ch/documentation/13814/A83F2CB0D4E5635FB2B173992F39D065.pdf
2. **One lambda probe per header pipe** (M12 thread, 25 Nm; wiring diagram "RH and LH lambda probe"): SSM excerpt; owner's manual https://apriliasuperstore.com/pdf/179055 ; Mivv instructions "Unhook and remove the two lambda sensors from the original collectors" https://cdn.shopify.com/s/files/1/0261/6125/0381/files/A013_DELTAXM1-ALTI_ISTRUZIONI-DI-MONTAGGIO.pdf ; Graves: "Front OEM-sized Lambda receivers are in each down tube" https://factorysuperbike.com/products/graves-motorsports-aprilia-rs660-tuono-660-full-titanium-exhaust-system-20-24
3. **Headers are stepped with a slip-joint/expanded section after the U-bend, and merge in a short Y immediately at the inlet of a large box** ("cat box"). Austin Racing's box-delete instructions have the owner cut the stock headers on the straight, enlarged section just behind the bend and tell you to "Undo cat box bolt and drop headers / cat down and out"; their photos (file `stock_headers_2021-22_photo_austinracing_instr.png`) show the two stock pipes with the step and the Y at the box: https://apriliasuperstore.com/pdf/179073 . The whole system is removed as one assembly after the 4 header nuts and one central bolt: Spark instructions (above), Mivv instructions (above, photo 24 = `stock_exhaust_2020-24_photo_mivv_instr.png`), SC-Project kit instructions ("Remove the original exhaust assembly (L)").
4. **One underbelly box = catalyst + silencer.** MCN at launch: "Twin exhaust header pipes, a catalyst, and underslung silencers, packaged low and centralised" https://motorcyclenews.com/news/new-tech/aprilia-660-engine ; the box is called the "cat box" by Austin Racing; Akrapovič says of its own replacement that "the catalyst is located in the front part of the presilencer" https://alphatechnik.com/akrapovic-racing-line-carbon-exhaust-system-for-aprilia-rs660-2021-tuono-660-2021-with-street-approval/ak-s-a6r4-hapc ; Zard: "the OEM exhaust is positioned below the engine" https://moto.motorionline.com/en/officine-italiane-zard-nuovo-scarico-completo-omologato-per-aprilia-rs-660-notizia/ . EPA: single-bed TWC (one brick). Owner's manual: "three-way catalytic converter (platinum, palladium and rhodium)" https://apriliasuperstore.com/pdf/179055 p.130.
5. **No exhaust flap / servo valve.** None appears in the SSM electrical section (only the secondary-air valve and the EVAP purge valve), none in the owner's manual, none mentioned by any aftermarket maker: https://manuals.plus/m/56a8c3a57e40262b784a845049181981d6935aa56217222bcfd6980ccb6d2b50_optim.pdf
6. **Outlets.** Not documented in any text source I found. The Mivv photo shows one short outlet stub at the rear of the box; I could not verify "exits both sides". **Owner must confirm count, side, diameter and length of the outlet tubes** (and whether one is a dummy).
7. **Material.** Owner says full stainless; consistent with every aftermarket comparison (steel replacements save only 0.4–3 kg). No OEM document states the alloy.
8. **Mass of the complete stock system:** 6.10 kg (Mivv, 2020-21 bike) https://mivv.com/en/product/a-014-ldrb-aprilia-rs-660-2020-2024/ ; 6.4 kg "OEM" (SC-Project, 2025-26 bike) https://shop.sc-project.com/en/brands/aprilia/rs-660-2025/a23c-ac90c-2-1-stainless-steel-full-exhaust-system-with-sc1-r-carbon-exhaust . Akrapovič's catalysed Euro 5 system is only 0.4 kg lighter than stock (alphatechnik link above); Akrapovič's 2025 de-cat race system saves 2.41 kg (motoee link above).

### 3.2 Parts numbering

- OEM silencer/box P/N **2B005290** (from the owner): no hit anywhere on the open web (only unrelated documents) — Piaggio's EPC is dealer-only and the third-party catalogue mirrors (CMSNL, motorcyclespareparts.eu, bike-parts-aprilia) blocked automated access (HTTP 403). Not verifiable from here.
- Exhaust gasket 2B012220 / 852090 (shared with RSV4/Tuono V4): https://www.apworkshops.co.uk/exhaust-gasket-v4.html
- Exhaust valve (engine poppet) 1A016659: https://www.aspecialparts.com/shop/engine/spare-parts/exhaust-valve-1a016659-for-660-engines/

---

## 4. Dimensional reference points (aftermarket, for sanity-checking) and estimates

Nothing below is a measured stock dimension. Use for bounding only.

| Quantity | Reference value | Source / note |
|---|---|---|
| Aftermarket header OD (QD, full system) | 42 mm, stepped to a 52 mm final link pipe | https://www.hsbkracing.com/parts-and-apparel/aprilia/rs-660/exhaust/qd-aprilia-rs-660-tuono-660-full-system-titanium-gunshot-dark-matter-titanium-tri-cone/ |
| Arrow 2-1 collector outlet (to slip-on) | 54 mm | https://www.easyparts.com/Collector-Racing-ARROW-Aprilia-RS-Tuono-660-E5-2021-2023-p33841766 ; catalysed version 3.79 kg https://www.easyparts.com/Collector-catalytic-ARROW-Aprilia-RS-Tuono-660-E5-2021-2023-p33885810 |
| Lextek downpipe → silencer | 51 mm link pipe | https://www.lextekproducts.com/part/EXKT7431 |
| Max Torque Cans rear section (retains stock headers) | Ø60 mm | https://maxtorquecans.com/?p=224233 |
| Austin Racing box-delete clamps onto cut stock headers | 2 × "51–55 mm" clamps (header-to-collector slip joints); 1 × "59–63 mm" clamp (AR box to AR tail) | https://apriliasuperstore.com/pdf/179073 |
| Akrapovič Euro 5 replacement catalysts certified on this engine | ø82 × 120 mm or ø83 × 120 mm (three variants); Akrapovič outlet pipe ø40 mm; resonator oval 190×148, L 190 mm; silencer hexagonal 94.9×126.8, L 250 mm | Type-approval e26*08171 https://prd.polo-motorrad.com/on/demandware.static/-/Sites-polo-master/default/dwa98a2f30/pdf/DE000966973.pdf and https://www.easyparts-recambios.es/documentation/13263/9cd96fc0-4924-45fc-b00b-5bff93954182.pdf |
| Exhaust gasket | OD 45 / ID 36 / t 4 mm | https://www.lextekproducts.com/part/EXKT7431 |
| Stock noise (Spark table, "Original") | 99 dB(A) @ 5250 rpm (static) | https://www.wrs.it/en/complete-exhaust-system/498905-complete-racing-exhaust-force-evo-titanium-spark-aprilia-rs-660-tuono-660-2020-2026.html |

**Estimates (est) — to be replaced by the owner's measurements:**

- **Primary header OD at the flange: ≈38 mm (est).** Reasoning: gasket seat ID 36 mm; a 1.2–1.5 mm-wall tube that flares against a 36 mm-ID donut gasket is typically 38 mm OD / ~35.5 mm ID; aftermarket primaries for this engine are 42 mm (QD) and the stock pipe in the Austin Racing photo is visibly smaller than its own secondary section. Range 36–42 mm.
- **Secondary (post-step) header section OD: ≈48–51 mm (est, low confidence).** Reasoning: Austin Racing supplies 51–55 mm clamps for the slip sleeves that go over the cut stock secondaries; a sleeve clamped at 51–55 mm OD has an ID of roughly 48–52 mm. The photo shows a clear step of about +25 % after the U-bend. Could also be ~45 mm if the AR sleeves are thick-walled. Measure.
- **Primary length (port flange → merge at box inlet): roughly 500–650 mm (est).** Reasoning only from photo proportions (`stock_exhaust_2020-24_photo_mivv_instr.png`): the pipes drop in a U from the forward-canted head, run back under the sump and enter the box just behind the front of the engine. The two pipes are **visibly unequal** (the left-cylinder pipe takes the outer path) — the difference looks like 30–80 mm. Measure both centrelines.
- **Catalyst brick: single metallic substrate, ≈ø80–100 × 80–120 mm (0.4–0.9 L), ≈300–400 cpsi (est).** Reasoning: EPA "single-bed"; Akrapovič's Euro 5 replacement cats certified for this engine are ø82–83 × 120 mm (0.63 L), which is a strong proxy for the size Piaggio needed; metallic 300–400 cpsi is standard Euro 5 motorcycle practice. Position: inside the front of the underbelly box, directly after the Y merge (from the Austin Racing "cat box" description and the absence of any separate canister in the removed-system photo). Cell density is **not** in any public document.
- **Silencer box gross volume: order of 8–12 L (est, ±40 %).** Reasoning: photo scaling only (box ≈ 2–2.5 header-pipe widths tall, ≈ 6–7 wide, ≈ 9–10 long, using ~45 mm pipe as the scale). Internal layout (number of chambers, perforated tube, packing) is **unknown**; the owner's manual mentions no serviceable packing.
- **Outlet(s): unknown.** Akrapovič's Euro 5 replacement for the same bike uses a single ø40 mm outlet; if the stock box has two outlets, each is plausibly 35–45 mm (est).

---

## 5. What could NOT be found (searched: Aprilia/Piaggio press kits 2020 & 2024, Aprilia India spec sheet, 2020 owner's manual, 2021 service manual excerpt, EPA database, CARB EO lists, Akrapovič/SC-Project/Arrow/Mivv/QD/Spark/Graves/Lextek/Zard/Austin Racing/Two Brothers/Max Torque Cans pages and fitting instructions, eBay OEM listings, apriliaforum/reddit via search, Italian/German press)

- Stock header OD/ID, wall thickness, step location, centreline lengths, equal/unequal length.
- Merge/collector geometry (angle, length of the Y before the box).
- Catalyst substrate diameter, length, cell density, wall thickness, position relative to the box inlet.
- Any pre-silencer / internal chambers, perforated-tube diameter and perforation ratio, packing.
- Silencer box external dimensions and volume; outlet count, diameters, lengths.
- Whether the 2025+/US-2026 box differs physically from 2020-24 (beyond the extra lambda boss).
- Valve head diameters, lift, cam timing/duration, exhaust port geometry.
- Airbox volume, trumpet lengths/diameters, intake duct geometry.
- 2025 owner's/workshop manual (to confirm idle speed, throttle body and any exhaust note). Piaggio parts catalogue entries (P/N 2B005290 unverifiable).

---

## 6. Measurement list for the owner (3D scan + callipers; this is what the model actually needs)

Scan the complete system off the bike if possible (4 header nuts + 1 central bolt + 3 lambda connectors per all fitting instructions). Then record:

**Headers (each pipe separately; label L = left cylinder, R = right)**
1. OD and wall at the flange spigot, immediately after the bend, and in the secondary section; note exactly where the step/slip joint is (distance from flange face).
2. Centreline length flange face → start of Y merge, per pipe (from the scan; expect unequal).
3. Bend radii (for the OpenWAM friction/heat-transfer length only, not critical).
4. Lambda boss positions (distance from flange) for all three probes.
5. Exhaust port: bore at the gasket face (expect ≈36 mm) and depth from gasket face to valve seat if a bore gauge can reach; port shape (round/oval).

**Merge and catalyst**
6. Y-merge: included angle, length from merge start to box inlet, inlet diameter at the box.
7. Catalyst: if the box can be inspected with a borescope through the lambda boss or outlet, measure brick diameter and length; otherwise tap-test / thermal-image the box to locate the brick ends and measure the housing OD and length. If the box is ever cut open (not recommended on a 2026 bike) count cells per square inch.

**Silencer box**
8. External envelope from the scan (volume via the scan's closed mesh).
9. Internal: borescope through the outlet(s) — count baffles/chambers, perforated-tube ID and perforation pattern, presence of fibre packing.
10. Outlets: number, side(s), tube ID/OD, length from the last chamber wall to the tip, any inner restrictor.

**Intake (for the same model)**
11. Airbox internal volume (fill with water or from scan of the lid + base), filter area, snorkel/duct cross-section and length from fairing nose to airbox.
12. Trumpet length and inlet diameter for each cylinder (expect different lengths), throttle body bore (expect 52 mm), runner length throttle body → head face, intake port bore at the head.

**Operating points for validation**
13. Confirm idle speed on the dash with warm engine (expect 1400 ± 100 rpm unless Aprilia changed it for Euro 5+).
14. Record the rev limiter value and the rpm at which the map changes (if visible).

---

## 7. Suggested starting values for the OpenWAM model (all (est) unless noted — replace as measured)

- Cylinders: 2, bore 81 mm, stroke 63.93 mm (sourced), CR 13.5 (sourced), firing 0°/270° (sourced), rated 77.2 kW @ 10,400 rpm (sourced), idle 1400 rpm (sourced for 2020-24).
- Exhaust primaries: 2 × Ø38 mm (est) → step to Ø48–51 mm (est) at ≈200–250 mm from the flange (est from photo), total centreline 500–650 mm (est), unequal by 30–80 mm (est), stainless, wall 1.2–1.5 mm (est).
- Merge: short Y into a single Ø≈55–60 mm (est) inlet of the box (bounded by Arrow's 54 mm and Max Torque Cans' 60 mm aftermarket mid-sections).
- Catalyst: one brick Ø85 × 115 mm, 400 cpsi, metallic (est; proxy Akrapovič Ø82–83 × 120 mm Euro 5 cats for this engine), located 50–100 mm after the merge inside the box front.
- Silencer: 8–12 L box (est), chambers unknown; outlets 1 or 2 × Ø40 mm (Akrapovič proxy, est) × 100–150 mm (est).
- Intake: 2 × Ø52 mm throttle bodies (sourced), fixed trumpets (sourced), lengths unknown; airbox volume unknown; single front ram-air duct (sourced).
- Emissions hardware to represent: single TWC, PAIR injection into exhaust ports (sourced, EPA), 3 lambda probes (2 pre-cat in headers, 1 post-cat) for 2025+/US-2026 (sourced indirectly via Mivv/Spark/Akrapovič).
