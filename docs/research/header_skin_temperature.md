# Header skin temperature and heat clearance: research note

Status: literature and web survey, 2026-11-03. Every number has a link. A number marked **UNVERIFIED** could not be checked against an open source in this session. Do not hard-code those.

Scope: gasoline engines; mild steel, 304 and 321 stainless and titanium tube; bare, ceramic-coated or wrapped.

---

## 0. Bottom line

* The open literature has **almost no paired data for running gasoline headers** that gives gas temperature and skin temperature at a known distance from the port, at a stated rpm and load. The best data are OEM-type cast or stainless manifolds (NHTSA high-idle tests, a Mercedes 2.0 bench test, a turbo-V8 stainless manifold durability test). Magazine and coating-maker "tests" are mostly IR-gun readings on surfaces of unknown emissivity, so they are **not usable for validation**. See §1.3.
* The accepted method is a 1-D series resistance model: gas-side convection (a steady turbulent pipe correlation × an augmentation factor), then wall conduction, then wrap or coating conduction, then outside natural or forced convection plus radiation. Konstantinidis, Koltsakis & Stamatelos (1997) is the cleanest open reference for this whole chain, with constants (§2, §3).
* A low-emissivity ceramic coating mainly cuts **radiation to neighbours**. It does not cut the tube's own skin temperature. Physically the skin runs hotter (§6 sanity run). Wrap lowers the outer surface temperature and roughly halves heat loss, but the steel under it runs about 100 °C hotter.

---

## 1. Measured surface temperatures

### 1.1 Usable data (gasoline or petrol, method stated)

| # | Engine / vehicle | Condition | Gas temp | Skin temp | Location | Method | Source |
|---|---|---|---|---|---|---|---|
| A | 1999 Ford Explorer (OEM manifold) | high idle 1500–1800 rpm, ~1 h | n/a | runner cyl 3: 610 °F (321 °C); L collector 750 °F (399 °C); R runner cyl 2: 540 °F (282 °C); R collector 720 °F (382 °C); take-down 610 °F (321 °C) | runner / collector | welded thermocouples | [UW vehfire, citing NHTSA docket 98-3588-204](https://depts.washington.edu/vehfire/ignition/autoignition/surftemperdetail.html) |
| B | 1999 Honda Accord | high idle 1500–1800 rpm, ~70 min | n/a | runner cyl 3: 610 °F; runner cyl 4: 514 °F; R collector 754 °F | runner / collector | welded TC | same page (docket 98-3588-202) |
| C | 1999 Chevrolet Camaro | high idle 1500–1800 rpm, 1–3 h | n/a | runners 680–970 °F (360–521 °C); collector 750–900 °F; take-down 720–750 °F; cyl 4 runner fell 210 °F in 3 min after the test | runner / collector | welded TC | same page (docket 98-3588-190) |
| D | 1996 Dodge Caravan | 34 mph / idle 900 rpm 11 min / idle + 1200 rpm 20 min | manifold gas 1134 / 802 / 1008 °F | front manifold surface 275 / 277 / 282 °F (looks shielded or remote; treat with care); cat surface 667 / 396 / 563 °F | manifold, cat | TC | same page (docket 98-3588-30) |
| E | Mercedes 4-cyl petrol 1997 cc, cast-iron 4-2-1 manifold | 1000–3000 rpm at 24 N·m (part load); the 2200 rpm case is reported | outlet Tg 617–641 °C (model) | wall at TC-9…12: 435–490 °C (model, plain manifold); model vs measured within 1.8–12 % | runner points TC-9…TC-12 | type-K TC, 9 skin zones | [Assi et al. 2020, JARFMTS 69(2)](https://semarakilmu.com.my/journals/index.php/fluid_mechanics_thermal_sciences/article/download/6164/3034/31784) |
| F | Fiat 170A1 900 cc petrol | 3000 rpm, 10–40 N·m | manifold gas 660–730 °C | (IR; manifold ε set to 0.93, no absolute skin value in text) | manifold | K-TC + FLIR T335 | [Worsztynowicz et al. 2017](https://yadda.icm.edu.pl/baztech/element/bwmeta1.element.baztech-943e7d4d-441a-410e-b6a7-9a5bdbde06ba/c/worsztynowicz_uhrynski_borkowski_pluta_the_analysisce_3_2017.pdf) |
| G | Opel X18XE 1.8 petrol | 2000 / 3000 rpm, load not stated | n/a | > 200 °C at 2000 rpm; ~250 °C at 3000 rpm; then above the 270 °C camera limit | manifold | IR camera | [KONES 2012 vol 19 no 4](https://kones.eu/ep/2012/vol19/no4/20.pdf) |
| H | Two turbo V8s, Nb-stabilised cast stainless manifolds | full-load / rated-power durability cycles | n/a | critical locations 750–850 °C; thermal-shock max ~900 °C | 36 skin TCs | TC; FE within 2–3 % | [Unimore, Eng. Failure Analysis 2023](https://iris.unimore.it/retrieve/42a3774a-399b-4012-8464-a1d9e41cf9f2/1-s2.0-S1350630723004806-main.pdf) |

### 1.2 Anecdotal tubular-header readings (forum; for plausibility only)

| Condition | Reading | Method | Source |
|---|---|---|---|
| LS truck primaries, ~20 min half-throttle town driving | 410–440 °F | laser gun | [LS1Tech](https://ls1tech.com/forums/pcm-diagnostics-tuning/1161184-primary-header-tube-temps.html) |
| Warm idle, primaries | 450–500 °F | laser gun | same |
| 6.0 Suburban towing ~12,000 lb, just after a long climb | "about 1100" (°F presumably) | not stated | same |

### 1.3 Bare vs coated vs wrapped "tests" (why they are unusable)

| Claim | Numbers | Problem | Source |
|---|---|---|---|
| Hot Rod (quoted on forum): Hooker 1-7/8 in coated vs black-painted, on dyno | coated 258 °F / painted 870 °F right after the run; 195 / 520 °F one minute after | No instrument named. A 600 °F drop is not physically plausible for a thin coating; it fits an IR gun reading a low-ε coating | [LS1Tech thread](https://ls1tech.com/forums/generation-iii-external-engine/1904298-temp-differences-coated-headers-vs-not-coated.html) |
| Engine Masters S7E10 "Do header wraps work?" (forum recap) | ceramic ≈ 10 °F lower on the outside; wrap ≈ 59 °F | secondhand; no baseline given | [CorvetteForum](https://www.corvetteforum.com/forums/c3-general/4667860-do-header-wraps-work-engine-masters-s7-ep10.html); [episode listing](https://www.tvmaze.com/episodes/2339340/engine-masters-7x10-do-header-wraps-work) |
| GRM Z06, Swain White Lightning | 10 ° cooler after 2 min of MAPP flame on the collector | flame test, not an engine | [GRM](https://grassrootsmotorsports.com/project-cars/2004-Chevrolet-corvette-z06/project-z06-cooling-our-headers-swaintechs-white-l) |
| Swain Tech | 30–50 % lower "radiant temperature" ~1 in from the part | vendor claim | [GRM Mustang](https://grassrootsmotorsports.com/project-cars/1965-mustang-fastback/are-all-header-coatings-same-project-vintage-race) |
| Jet-Hot | "over 50 %", ">300 °F", CarCraft "over 60 %" | vendor marketing, no conditions | [fordsix.com](https://fordsix.com/ci/JetHot.html) |
| Jet-Hot Extreme 2500 | "~10 %" skin temperature drop | no conditions | [Jet-Hot thermal](https://commercial.jet-hot.com/thermal) |
| Moroso / DEI (EngineLabs) | wrap: surface −30 %, underhood −50 %, "300–400° drop" | no conditions | [EngineLabs](https://www.enginelabs.com/?p=246638) |
| Sartor Bros (diesel, coated manifold) | flange 238 → 166 °C | diesel, vendor blog | [enginecoating blog](https://enginecoating.blogspot.com/2007/06/dyno-test.html) |

**Flag:** an IR gun set to ε ≈ 0.95 and pointed at a coating with ε ≈ 0.2–0.5 reads hundreds of degrees low. This is the most likely reason for the large "coated is 60 % cooler" claims. A coating's emissivity is about 0.2 vs about 0.6 for the bare part, per [MGA Guru](https://mgaguru.com/mgtech/carbs/ex205.htm). That page also argues the coated skin may be *hotter*. Use only contact or welded thermocouples for validation.

---

## 2. Gas-side (internal) heat transfer

### 2.1 Base correlations (time-averaged, steady)

| Name | Form | Validity | Source |
|---|---|---|---|
| Gnielinski | Nu = (f/8)(Re−1000)Pr / [1.07 + 12.7√(f/8)(Pr^(2/3)−1)] (common form uses 1 in place of 1.07) | 10⁴ < Re < 5×10⁶ | [Konstantinidis et al. 1997](https://www.academia.edu/21379858/Transient_heat_transfer_modelling_in_automotive_exhaust_systems) |
| Sieder–Tate | Nu = 0.027 Re^0.8 Pr^(1/3) (μb/μs)^0.14 | fully developed | same; [MDPI Computation 2025](https://www.mdpi.com/2079-3197/13/9/223) |
| Dittus–Boelter | Nu = 0.023 Re^0.8 Pr^0.4 | fully developed | [Rahman et al. 2011 Table 1](https://core.ac.uk/download/268871449.pdf) |
| Meisner & Sorenson (takedown pipe, from Sachdev data) | Nu = 0.0774 Re^0.769 | exhaust pipe | [Konstantinidis 1997](https://www.academia.edu/21379858/Transient_heat_transfer_modelling_in_automotive_exhaust_systems) |
| Depcik & Assanis 2002, "universal" intake/exhaust | Nu = 0.0694 Re^0.75 | 1500 < Re < 40000 | [Rahman et al. 2011 Table 1](https://core.ac.uk/download/268871449.pdf); paper: [SAE 2002-01-0372](https://saemobilus.sae.org/papers/a-universal-heat-transfer-correlation-intake-exhaust-flows-spark-ignition-internal-combustion-engine-2002-01-0372) |
| Bauer et al. 1998 (intake manifold, straight / curved) | Nu = 0.062 Re^0.73 / 0.140 Re^0.66 | intake | [Rahman 2011](https://core.ac.uk/download/268871449.pdf) |
| Shayler et al. 1996 | Nu = 0.135 Re^0.713 | | same |

### 2.2 Augmentation for pulsation, entrance and bends ("CAF")

CAF = Nu_measured / Nu_fully-developed.

| Value | Where | Source |
|---|---|---|
| **2.5** (used with Gnielinski; best fit to NEDC data on a 2 L gasoline car) | whole exhaust line | [Konstantinidis 1997](https://www.academia.edu/21379858/Transient_heat_transfer_modelling_in_automotive_exhaust_systems) |
| **2.3 manifold, 3.0 takedown pipe, 1.6 tailpipe** (D. W. Wendland, SAE 931085, 1993, averaged over Re 4000-20000; "Daniel" in the MDPI paper is his first name, see [Balasubramanian 2018](https://core.ac.uk/download/215523088.pdf); corrected 2026-11-12) | per component | cited in [MDPI Computation 13(9):223](https://www.mdpi.com/2079-3197/13/9/223) |
| ~1.5 (heat transfer "about 50 % greater than steady flow correlations") | exhaust port (Malchow et al., SAE 790309) | [CSU heat-transfer notes](https://www.engr.colostate.edu/~allan/heat_trans/page9/page9.html) |
| 1.5–2.0 (unsteady intake flow: "50 to 100 %" over Dittus–Boelter) | intake | [Rahman 2011](https://core.ac.uk/download/268871449.pdf) |
| 20–30 | 100 mm downstream of the valve (single-cylinder diesel, entrance region) | [MDPI Computation 2025](https://www.mdpi.com/2079-3197/13/9/223) |
| CAF falls with Re and with distance from the entrance; downstream values match takedown/tailpipe data | straight-pipe extension of an SI exhaust port, 1000–4000 rpm | [SAE 2006-01-1033 abstract](https://saemobilus.sae.org/papers/cycle-averaged-heat-flux-measurements-a-straight-pipe-extension-exhaust-port-si-engine-2006-01-1033) |
| "ratio of measured to ideal Nu relatively constant for a given component" | full exhaust system | [SAE 931085 abstract](https://saemobilus.sae.org/papers/automobile-exhaust-system-steady-state-heat-transfer-931085) |

Geometric add-ons, all from [Konstantinidis 1997](https://www.academia.edu/21379858/Transient_heat_transfer_modelling_in_automotive_exhaust_systems):
* Entrance (Rohsenow): Nu(x)/Nu∞ ≈ 0.892 + 2.02 (x/d)⁻¹. Nu takes about 15–30 D to settle. The PDF text was partly garbled, so check this against the original.
* Bend (Hausen): Nu_bend/Nu_straight = 1 + 21 d / (R · Re^0.14). The source formatting was ambiguous, so verify it.

**UNVERIFIED (could not open the source):** Caton & Heywood (1981, IJHMT 24:581) time-averaged exhaust-port correlation, and Zapf's valve-lift-dependent port correlation. Both are widely cited, but I could not read their constants in any open source. Do not hard-code them. The sectoral blow-down/push-out approach ([SAE 2016-01-0202](https://saemobilus-test.cld.sae.org/articles/a-sectoral-approach-modelling-wall-heat-transfer-exhaust-ports-manifolds-turbocharged-gasoline-engines-2016-01-0202)) is the modern alternative. Its constants are paywalled.

---

## 3. Outside heat transfer (from [Konstantinidis 1997](https://www.academia.edu/21379858/Transient_heat_transfer_modelling_in_automotive_exhaust_systems))

* Natural convection, horizontal cylinder (Churchill–Chu): Nu = {0.6 + 0.387 Ra^(1/6) / [1 + (0.559/Pr)^(9/16)]^(8/27)}². The paper's extracted text shows 0.75. The standard Churchill–Chu constant is 0.60; use 0.60 and flag the difference.
* Forced (vehicle moving): Nu = 0.3 + √(Nu_lam² + Nu_turb²), with Nu_lam = 0.664 Re^½ Pr^⅓ and Nu_turb = 0.037 Re^0.8 Pr / [1 + 2.443 Re^−0.1 (Pr^⅔ − 1)]. Length scale = semi-perimeter. Valid for 10 < Re < 10⁷.
* Radiation: q = ε σ π d (T_p⁴ − T_amb⁴) per unit length.
* Double-wall air gap: Nu_gap = 0.2 Ra^0.25 (Ra > 7.1×10³), with s_gap = √(r₂r₃) ln(r₃/r₂).
* Bench CFD value for a still-air manifold exterior: h ≈ 25 W/m²K ([Unitbv manifold paper](https://webbut.unitbv.ro/index.php/Series_I/article/download/5020/3896/9715)).

---

## 4. Emissivity

| Surface | ε | T | Source |
|---|---|---|---|
| 18-8 stainless, oxidised | 0.86 | — | [Konstantinidis 1997 Table 1](https://www.academia.edu/21379858/Transient_heat_transfer_modelling_in_automotive_exhaust_systems) |
| 18-8 stainless, unpolished | 0.22 | — | same |
| 304 SS heated to 500 °C | 0.54 + (T−273)/2830 (T in K), so about 0.70 at 450 °C | | same |
| Mild steel, lightly aged | 0.17 + (T−273)/6950 | | same |
| Cast iron aged at 600 °C | 0.5 + (T−273)/2860 | | same |
| **347 stainless (stabilised, ≈ 321), stably oxidised** | **0.87–0.91** | 600–2000 °F (315–1095 °C) | [NASA Memo 1-20-59L (Wade 1959)](https://ntrs.nasa.gov/citations/19980228304) |
| Stainless 18-8 oxidised at 800 °C | 0.85 | 60 °C | [Optris table](https://optris.com/us/technology/emissivity-table/) |
| Stainless, rolled / sandblasted | 0.45 / 0.7 | 700 °C | same |
| Steel, oxidised | 0.88 | 200–600 °C | same |
| Steel oxidised at 872 K | 0.79 | 199–599 °C | [Neutrium](https://neutrium.net/heat-transfer/total-normal-emissivities-of-selected-materials/) |
| Steel plate, rough | 0.94–0.97 | 38–371 °C | same |
| Iron, smooth oxidised | 0.78–0.82 | 227–527 °C | same |
| Titanium, polished | 0.15 / 0.2 / 0.3 | 200 / 500 / 1000 °C | [Optris](https://optris.com/us/technology/emissivity-table/) |
| **Titanium, oxidised at 540 °C** | **0.35 / 0.5 / 0.6** | 200 / 500 / 1000 °C | same |
| Ti 75A oxidised 300 h at 450 °C | 0.21–0.25 | 35–425 °C | [Neutrium](https://neutrium.net/heat-transfer/total-normal-emissivities-of-selected-materials/) |
| Flame-sprayed zirconia / alumina | 0.62→0.44 / 0.69→0.44 | 800→2000 °F | [NASA Wade 1959](https://ntrs.nasa.gov/citations/19980228304) |
| Metallic-ceramic header coating (silver) vs bare | "may be" 0.2 vs 0.6 | — | [MGA Guru](https://mgaguru.com/mgtech/carbs/ex205.htm) (opinion, not a measurement) |
| Black silicone high-temperature coating | 0.93 | −25…750 °C | [Neutrium](https://neutrium.net/heat-transfer/total-normal-emissivities-of-selected-materials/) |
| Glass-fibre laminate | 0.91 | 70 °C | [Optris](https://optris.com/us/technology/emissivity-table/) |
| Refractory, "good radiators" | 0.80–0.90 | 600–1000 °C | [Neutrium](https://neutrium.net/heat-transfer/total-normal-emissivities-of-selected-materials/) |

**Gaps:** I found no measured high-temperature ε for Jet-Hot, Cerakote or Swain coatings, or for fibreglass or basalt wrap fabric. Heat-blued titanium varies a lot with oxide colour.

---

## 5. Wraps and coatings: conductivity and thickness

| Product | Thickness | k | Rating | Source |
|---|---|---|---|---|
| Thermo-Tec exhaust wrap (fibreglass) | 0.0625 in (1.6 mm) | 0.328 BTU·in/hr·ft²·°F = **0.047 W/m·K at 73 °C** | 2000 °F use limit | [Thermo-Tec spec sheet](https://thermotec.com/content/Spec%20Sheets/Wrap%20and%20Exhaust%20Jackets%20Spec%20Sheet%202022.pdf) |
| Heatshield Products exhaust wrap | 0.065 in ±10 % (1.65 mm) | "1.3 W/m·K", "fibre only" | 1000 °F base / 1200 °F coated / 2000 °F < 30 s | [HSP data sheet](https://sdda.semadata.org/Standard/Heatshield%20Products/exhaust-wrap-data-sheet.pdf) |
| HSP Lava (basalt) wrap | — | "0.035 W/m·K at 25 °C", fibre only | 1200 °F service, 2400 °F melt | [HSP Lava data sheet](https://heatshieldproducts.com/wp-content/uploads/2024/05/lava-exhaust-wrap-data-sheet.pdf) |
| DEI glass-fibre / Titanium (basalt) wrap | — | — | 1200 °F / 1800 °F direct (2500 °F intermittent) | [EngineLabs](https://www.enginelabs.com/?p=270754) |
| Jet-Hot Classic (ceramic-metallic) | 1.5–4.0 mil (38–100 µm) | 0.2–1.8 W/m·K (ASTM C177) | 1250 °F (677 °C) | [Jet-Hot thermal](https://commercial.jet-hot.com/thermal) |
| Jet-Hot Extreme 2500 (thermal barrier) | 6–13 mil (0.15–0.33 mm) | 0.07–0.12 W/m·K (ASTM D5470) | > 2500 °F | same |
| Columbia PowerKote CBC1 (metallic ceramic) | 0.5–1.0 mil | not stated | > 2000 °F adhesion | [Columbia CBC1 TDS](https://www.columbiacoatings.com/shared/images/TDS/CBC1-Data-Sheet.pdf) |
| Generic insulation in double-wall pipe (model value) | — | 0.1 W/m·K, ρ 600, c 1000 | — | [Konstantinidis 1997](https://www.academia.edu/21379858/Transient_heat_transfer_modelling_in_automotive_exhaust_systems) |

**Flags:**
* Wrap k values disagree by about 40×: 0.035 and 0.047 vs 1.3 W/m·K. The low values are near still air at room temperature. The 1.3 is probably the solid fibre. Real installed wrap at 400–800 °C should be well above 0.047, because air conductivity and radiation rise with temperature. I found no high-temperature data.
* A 50 µm coating at k ≥ 0.2 W/m·K has R ≈ 2.5×10⁻⁴ m²K/W, which is negligible next to the gas-side 1/h ≈ 3×10⁻³. A thin header coating works almost entirely through ε. Only the 0.15–0.33 mm barrier grades add a measurable conductive resistance.

---

## 6. EGT at the port or primary (gasoline)

| Value | Context | Source |
|---|---|---|
| Manifold gas 1134 °F (612 °C) at 34 mph; 802 °F idle; 1008 °F at 1200 rpm | Dodge Caravan | [UW vehfire](https://depts.washington.edu/vehfire/ignition/autoignition/surftemperdetail.html) |
| 660–730 °C | 900 cc petrol, 3000 rpm, 10–40 N·m | [Worsztynowicz 2017](https://yadda.icm.edu.pl/baztech/element/bwmeta1.element.baztech-943e7d4d-441a-410e-b6a7-9a5bdbde06ba/c/worsztynowicz_uhrynski_borkowski_pluta_the_analysisce_3_2017.pdf) |
| 617–641 °C outlet | 2.0 petrol, 2200 rpm, 24 N·m | [Assi 2020](https://semarakilmu.com.my/journals/index.php/fluid_mechanics_thermal_sciences/article/download/6164/3034/31784) |
| can exceed 1600 °F (870 °C) "under extreme operating conditions" | GM full-size truck, OEM upfitter guide | [GM Body Builder 2015 C/K](https://www.gmupfitter.com/wp-content/uploads/2021/05/2015_LD_FS_CK_Gen_012814.pdf) |
| TIT limit 930 °C; exhaust "may exceed 900 °C" | 1.3 L turbo gasoline | [MDPI Sustainability 15(5):4559](https://www.mdpi.com/2071-1050/15/5/4559) |
| NA drag engines: ~1325 °F typical; > 1350 °F = lean | 565 ci BBC (anecdote) | [ViperClub](https://www.viperclub.org/vca/threads/egt-cylinder-tuning-header-mods.588297) |
| 100–150 °F cylinder-to-cylinder spread is normal | forum | [24 Hours of Lemons forum](https://forums.24hoursoflemons.com/viewtopic.php?id=22569) |
| Typical probe position ~6 in from the head | EGT kit instructions | [Pegasus](https://pegasusautoracing.com/productdetails.asp?RecID=67) |
| TC uncertainty ~40 °C from radiation and conduction | instrumentation | [Unibo J. Eng. 2022](https://cris.unibo.it/bitstream/11585/893393/3/JENG-2022-0001_R1%20NO%20REBUTTAL.pdf) |

**Gap:** I found no open, rigorous source for NA-gasoline EGT at a fixed distance from the port at WOT vs cruise. Heywood's textbook is the usual citation, but it is not online.

---

## 7. Temperature limits of nearby parts

| Item | Limit | Source |
|---|---|---|
| PVC primary wire GPT / HDT | 80 °C | [Sycor](https://www.sycor.com/blog/post/inspecting-end-to-end-automotive-primary-wire) |
| PVC TWP | 105 °C | same |
| XLPE GXL / SXL / TXL | 125 °C | same |
| Silicone wire | 200 °C | [Hi-Line](https://hi-line.com/wire-cable/wire/silicone-high-temp-wire) |
| ECM / TCM modules (GM) | < 185 °F (85 °C) at all times | [GM Body Builder 2015](https://www.gmupfitter.com/wp-content/uploads/2021/05/2015_LD_FS_CK_Gen_012814.pdf) |
| Brake fluid, dry / wet ERBP minimums | DOT 3: 205 / 140 °C; DOT 4: 230 / 155 °C; DOT 5: 260 / 180 °C | [49 CFR 571.116](https://www.law.cornell.edu/cfr/text/49/571.116) |
| GM rule for brake fluid | keep it "below the boiling point of water under all operating conditions" | [GM GMT610 manual](https://www.manualslib.com/manual/1951255/Gmc-Gmt-610.html?page=13) |
| Nylon / multilayer fuel tube (SAE J2260) | −40…115 °C; 115 °C peak intermittent; ≤ 90 °C long-term continuous | [SAE J2260](https://saemobilus.sae.org/standards/j2260_199611-nonmetallic-fuel-system-tubing-one-layers) |
| Rubber fuel hose SAE J30R9 | −40…150 °C (one vendor) | [Kemo](https://www.kemohose.com/fuel-hose-sae-j30r9.html) |
| Boot elastomers: CR (neoprene) / PUR, VMQ / ECO, AEM | 110 / 130 / 150 °C | [SAE 880311](https://saemobilus.sae.org/content/880311) |
| ABS max continuous | 86–89 °C (high-heat grades 75–110 °C) | [SpecialChem](https://www.specialchem.com/plastics/guide/max-continuous-service-temperature) |
| PA66 / PA66-GF30 | 80–140 / 100–150 °C | same |
| PP (all grades) | 100–130 °C | same |
| PBT / PPS / PEEK | 80–140 / 200–220 / 154–260 °C | same |
| Starter solenoid, aluminium oil pan, body paint | **no sourced number found**; leave user-set | — |

### 7.1 Published clearance rules

| Rule | Source |
|---|---|
| Fuel lines: "5 in. minimum clearance to exhaust system is required or a metal shield must be provided" | [GM 2015 C/K Body Builder §8](https://www.gmupfitter.com/wp-content/uploads/2021/05/2015_LD_FS_CK_Gen_012814.pdf) |
| Fuel system (van upfit): "12 in. minimum clearance … or a metal shield" | [GM G-Van manual p.15](https://www.manualslib.com/manual/3091981/Gmc-G-Van.html?page=15) |
| Brake hoses: ≥ 2.0 in from all exhaust parts in their closest positions; "heat shielding is likely required with clearances even greater than 2.0 in." | [GM GMT610](https://www.manualslib.com/manual/1951255/Gmc-Gmt-610.html?page=13); [GM 2015 C/K §5](https://www.gmupfitter.com/wp-content/uploads/2021/05/2015_LD_FS_CK_Gen_012814.pdf) |
| VW: only "sufficient clearance" (no number) | [VW service info](https://manuals.autorepairshq.com/Volkswagen/2008/Rabbit%20%281K1%29%20L5-2.5L%20%28BGQ%29/Repair%20and%20Diagnosis/Engine%2C%20Cooling%20and%20Exhaust/Exhaust%20System/Description%20and%20Operation/General%20Repair%20Information) |
| NHRA 1:5: the only distance found is fuel components ≥ 6 in forward of the bellhousing; no header-distance rule found | [NHRA 1:5 excerpt](https://www.thechicagogarage.com/goto/post?id=2992138) |
| SAE J2045 (fuel tubing assemblies) is paywalled, so its clearance content is not verified | [SAE J2045](https://sae.org/standards/content/J2045_201211/?PC=DL2BUY) |
| The "1 in from a heat shield" rule of thumb: **no primary source found**. HSP only says to leave a gap | [HSP blog](https://heatshieldproducts.com/blog/why-leaving-a-gap-is-crucial-for-installing-heatshield-armor/) |

---

## 8. What to use in the model

1. **Gas side:** Gnielinski with **CAF = 2.5** as the default ([Konstantinidis](https://www.academia.edu/21379858/Transient_heat_transfer_modelling_in_automotive_exhaust_systems)). Offer per-component options: primaries/manifold 2.3, collector or takedown 3.0, tailpipe 1.6 ([Daniel via MDPI](https://www.mdpi.com/2079-3197/13/9/223)). Add the Hausen bend factor, and the entrance factor for the first ~15 D. Use time-averaged ṁ per primary. Below Re ≈ 10⁴ (idle) Gnielinski is out of range; warn, or switch to Depcik–Assanis (0.0694 Re^0.75). Reason: CAF 2.5 was fitted on a gasoline car, and the component values bracket it.
2. **Wall:** k ≈ 15–25 W/m·K for stainless, 45–50 for mild steel, 7–20 for Ti. These are handbook values I did not source here, but wall resistance is negligible anyway.
3. **Coating:** ε override plus an optional thin layer (k 0.07–0.12, t 0.15–0.33 mm for barrier grades; neglect thin decorative grades).
4. **Wrap:** t = 1.6 mm per layer. Use **k = 0.06–0.10 W/m·K** at operating temperature. That is an engineering judgement above the 0.047 room-temperature sheet value, because no high-temperature data exist, so expose it as a parameter. Outer ε ≈ 0.9.
5. **Outside:** Churchill–Chu natural convection (0.60 constant) plus the forced-flow formula when vehicle or fan speed > 0, plus radiation.
6. **Emissivity defaults:** oxidised 304/321 **0.85** (0.70 when lightly heat-tinted); oxidised mild steel **0.85**; heat-blued Ti **0.5** (0.35–0.6); polished / new stainless 0.3; silver ceramic coating **0.3** (UNSOURCED measurement; user-set); black high-temperature coating 0.9; wrap 0.9.
7. **Clearance check:** compute the view-factor radiation and convection to a target surface. Compare against the §7 limits with a margin: use J2260's 90 °C continuous figure, not 115 °C. Default hard rules: brake hose ≥ 2 in (51 mm), fuel line ≥ 5 in (127 mm) unless shielded, both per GM.

### Sanity run (my implementation of the above; not data)
This uses a throwaway script that is not committed. It follows the chain in §2–§5: Gnielinski × CAF, then the wall, then the wrap, then Churchill–Chu plus radiation.

Case: 1-3/4 in × 0.065 in 304 primary, 40 °C still air, CAF 2.5.

| Case | Gas | Bare ε 0.85 | Coated ε 0.3 | Wrapped (1.6 mm, k 0.06) outer / steel |
|---|---|---|---|---|
| WOT ~450 hp V8, 0.055 kg/s per primary | 850 °C | 703 °C (≈1300 °F), 7.0 kW/m | 770 °C, 3.8 kW/m | 413 / 806 °C, 2.1 kW/m |
| Cruise, 0.006 kg/s | 650 °C | 409 °C | 479 °C | 302 / 508 °C |

These results agree in order of magnitude with §1.1 (cases A–C, E, H) and with the forum's "1100 °F towing" reading. With CAF 1.5 instead of 2.5, the WOT bare skin drops about 50 °C, so CAF is the dominant uncertainty after the gas temperature.

## 9. Best validation cases (ranked)
1. **Assi 2020 (E):** gas and skin together, petrol, rpm and torque known, geometry described. Best open case.
2. **NHTSA high-idle runner vs collector (A–C):** welded TCs, three vehicles. Gas temperature and flow are missing, so use these only as a range check.
3. **Unimore turbo V8 (H):** upper bound for full-load skin temperature, 750–900 °C.
4. **Konstantinidis 2 L NEDC:** wall and gas at the catalyst inlet (figures only; digitise them from the paper).

To build properly: run your own welded-TC (not IR) test on a customer header, with an EGT probe at the same station and logged rpm and MAP.
