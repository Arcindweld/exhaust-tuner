# PROGRESS (agent10/mount) - delete in the final commit

Task: Mounts designer (intercooler first; oil cooler, barrel, heat exchanger, can, BOV/WG support).

## Sources verified (2026-11-12)
- Garrett soft-mount (rubber isolation grommets; vibration damping; thermal expansion): garrettmotion.com Rob Dahm article.
- FIA App. J Art. 253 (253_2024.pdf): 7.2.2 extinguisher securing system and 7.3.6 manual extinguisher mountings
  "withstand a deceleration of 25 g"; Art. 2 cameras (rallies) 25 g.
- Bosch Motorsport vibration profile PDF: "Shock: 50gn 6mSec ISO 16750-3", 10 shocks pos+neg per direction.
- ISO 16750-3 preview (iteh): no numbers visible. SAE J1455: no open numbers.
- 14 CFR 25.303 factor of safety 1.5 on limit load (law.cornell.edu); 25.305 (govinfo): limit without permanent deformation.
- Transmissibility: uiowa 58:153 lecture 9 ("frequency ratio > sqrt(2) ... force transmitted less than static").
- AMC Mecanocaucho Type A bobbin (RS datasheet docs.rs-online.com/7588/0900766b81586730.pdf): max load daN + deflection mm,
  compression and shear (16 rows; columns A dia, B height inferred).
- Boteco P305 (stiffness only, no load rating): not used for selection.
- AlcoTec filler chart: typical fillet shear longitudinal/transverse 4043 11.5/15.0 ksi, 5356 17.0/26.0 ksi.
- AWS D1.1 (study guide open-exam-prep): fillet allowable 0.30 FEXX on throat, E70 21 ksi (145 MPa), throat 0.707 w.
- Fastenal metric: 8.8 proof 580 / UTS 800 MPa (M5-M16); 10.9 830/1040; As M5 14.2 M6 20.1 M8 36.6 M10 58 M12 84.3.
- Fastenal inch: J429 Gr5 proof 85 ksi UTS 120; Gr8 120/150; As 1/4 .0318 5/16 .0525 3/8 .0775 7/16 .106 1/2 .142.
- Portland Bolt: shear ~60% of min tensile; minor diameter when threads in shear plane.
- CTE: AmesWeb (ASM Metals Handbook Desk Ed. 1998) 3003 23.2, 6061 23.4, 5052 23.8 e-6/C.
- 6061 E 68.3 GPa (Protolabs data sheet). Steel E: page MATS (mild 205, 304 193).
- Not verified: Eurocode 9 / ADM fatigue categories -> static + g only. SendCutSend K-factor/bend radius (JS calc) -> inputs.

## Plan / status
- [ ] fusion-addin/mounts.py + tests/test_mounts.py
- [ ] page block (Hangers tab) MT_* + mtRender + DXF/SVG + sheet rows
- [ ] web/tests/mounts_ui.js
- [ ] cadtools actions mountPlace/mountPick/mountBuild + fake test + fusion_live_mounts.py
- [ ] docs/STATUS.md entry; run tests; delete this file
