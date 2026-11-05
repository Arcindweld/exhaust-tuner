# Checking the models against Rienstra and Hirschberg, *An Introduction to Acoustics*

The reference: S. W. Rienstra and A. Hirschberg, *An Introduction to Acoustics*, TU Eindhoven, 2004 edition (the
authors' open PDF, https://pure.tue.nl/ws/files/4270224/638803.pdf; 372 pages). It is the free text with the same
duct theory as Dokumaci's *Duct Acoustics* (Cambridge 2021) and Munjal's *Acoustics of Ducts and Mufflers* (Wiley):
plane waves, area changes, orifices, side branches, Helmholtz resonators, damping, flow effects, and Lighthill. The
sections read against our code so far, and what changed:

| Section | What it says | Ours | Change |
|---|---|---|---|
| 4.4.3 Orifice, 5.2.3 | an opening's inertia is that of the air in it plus an end correction each side, L_eff = L + 2 delta, delta of the order of the radius (0.85 a flanged, 0.6133 a unflanged) | the page's Mufflers tab adds 0.6133 x d; the OpenWAM writers wrote the bare neck into a point junction and a 0-D volume (no correction) | **writers v13: the Helmholtz neck is written 0.6133 x d longer, same area**. The Spintech trap runs before this tuned about 25 % high (59 mm neck, 54 mm wide: 92 mm effective) |
| 4.4.3, 5.2.4 Non-linear losses | at large amplitude a free jet forms in the opening and its kinetic energy is lost: dp = 1/2 rho (A/Ad u')^2, both directions; a sharp thin edge contracts the jet by beta = 0.6, so the loss is 1/beta^2 = 2.8 times that; rounded edges, 1 | writers v11: a quadratic loss K on the neck's velocity head, K given by the user | the Spintech slot runs used K 1.5; **2.8 is the book's value for a sharp edge** (rerun) |
| 4.4.3 mean flow through an orifice | with a mean flow U0 in the opening the loss is linear in u' (rho (A/Ad)^2 U0 u'), frequency independent, a very efficient damper; an orifice at a pipe end can be anechoic at one Mach number | OpenWAM's loss BC is K 1/2 rho u abs(u) on the total velocity, whose linearisation about U0 is this term | none: the quasi-steady loss carries both |
| 4.5 damping | viscothermal wall damping goes as sqrt(frequency): weak at low frequency | the catalyst note in outback_tilt.md used the same Kirchhoff form | none |
| 2.6.3 Lighthill | the acoustic analogy: quadrupole sources, the U^8 law for a cold jet | realism.py jet noise, with Hoch's hot-jet exponent | none |
| Morse & Ingard 9.1 (fig. 9.2), Levine & Schwinger 1948 | an unflanged open end reflects with an end correction 0.6133 a (valid below 2a / lambda = 1.22, the first cross mode) and radiates (ka)^2 / 4 of the incident power at low ka | the page's plane-wave models use END_CORR 0.6133 a; OpenWAM's open end is a constant-pressure discharge with neither | **writers v14: every pipe that ends open to the air (exhaust outlet, intake mouth) is written 0.6133 a longer at that end** (run setting open_end_corr, default 1; 0 writes the old files). The radiation resistance is still missing: at 1 kHz on a 60 mm tip it is 7 % of the incident power, so the pipe's high resonances are a little too sharp. Validation results before 2026-11-04 were run without v13/v14 |
| 4.4.2 area change | a gradual area change reflects little; a sudden one by (A1 - A2)/(A1 + A2) | OpenWAM's union BC (Borda-Carnot) and the page's transfer matrices | none |

Still to read against the code: Munjal 3.7-3.8 (extended-tube and cross-flow transfer matrices, for new Mufflers-tab elements) and 3.2 (finite-amplitude effects); Morse & Ingard 11.4 (jet noise) and 9.3 (duct discontinuities); Rienstra 7 (duct modes and the open end's reflection and radiation: our monopole-with-piston
directivity), 5.2.2 (resonance of a duct segment, our quarter-wave branches), 8.3 (the multiple-scales treatment of
a lossy neck, for a frequency-dependent K), and 2.5 / 3.2.5 (mean-flow effects on propagation and impedance).

## The library (2026-11-04)

Open-access texts found and read against the code (kept in the session scratchpad, not the repository; each is on its
publisher's or author's own server):

| Text | What it is | Read for |
|---|---|---|
| Rienstra & Hirschberg, *An Introduction to Acoustics*, TU/e 2004 (pure.tue.nl, 372 pp.) | the free duct-acoustics text | the table above: end corrections, orifice losses, flow damping |
| Zhou & Bodén, *Experimental investigation of an in-duct orifice with bias flow under medium and high level acoustic excitation*, KTH MWL, 2013 (mediatum.ub.tum.de, 12 pp.) | measurements of a 6 mm orifice, 0-19 m/s through it, 100-155 dB | **discharge coefficients 0.6-0.7 when the flow is turbulent (loss 1/Cc^2 = 2-2.8 velocity heads; 0.8 at low Reynolds number)**; the resistance with bias flow about U / (c0 Cc_M Cc), linear in the flow; end correction (pi/4) r a side, falling at high level; the thin edge far more level-sensitive than the 3 mm one. Our v11 loss element and K 2.8 for a sharp edge sit inside these numbers |
| Munjal, *Acoustics of Ducts and Mufflers*, Wiley 1987 (the user's copy, 320 pp.) | the transfer-matrix method and the muffler elements | **Mufflers tab: Rao and Munjal's grazing-flow perforate resistance 1 + 72.23 M (eq. 3.155) in the packed can; Munjal's measured junction back-pressure losses (eq. 8.4) and plug / cross-flow drops (8.7) as a back-pressure row; the sizing rule 3.5-12.5 x displacement for 20 dB(A), 0.38 x per dB(A); design criteria (a)-(e) in the tips**. His simple-chamber TL matches calcChamber exactly; his finding that mean flow barely changes an unperforated muffler's insertion loss (M 0.2) backs the tab's flow-free chamber models |
| Morse & Ingard, *Theoretical Acoustics*, 1968 (the user's copy, 933 pp.) | the reference text | open-end impedance (above): writers v14 |
| Hubbard (ed.), *Aeroacoustics of Flight Vehicles, vol. 1: Noise Sources*, NASA RP-1258, 1991 (ntrs.nasa.gov, 610 pp.) | the reference work on jet noise (Lilley's chapter) | confirms the U^8 law and cites Hoch et al. 1973 for the density (hot-jet) effect, which realism.py uses |
| NPTEL course 112104299, *Muffler Acoustics: Application to Automotive Exhaust Noise Control* (IIT Kanpur; 47 lectures, transcripts for 1-28, free) | Munjal's transfer-matrix method taught end to end, with MATLAB | the elements the Mufflers tab lacks: extended inlet/outlet, concentric-tube resonators, perforate impedance, cross-flow and plug mufflers, three-pass, Herschel-Quincke, 3-D piston-driven chambers |

KTH MWL doctoral theses that bear on the same questions and are open on DiVA (not reachable from this session's
network; read them on the PC): Zhou 2015 (orifices and perforates with flow at high level), Karlsson 2010
(aeroacoustics of duct branches, for silencers), Knutsson 2009 (IC-engine intake noise), Rämmal 2009 (flow duct
acoustics on turbocharged engines), Alenius 2012 (flow duct acoustics by LES), Hynninen 2015 (in-duct
characterisation of IC engines as sources).

Paid books worth having, in order: Munjal, *Acoustics of Ducts and Mufflers*, 2nd ed., Wiley 2014 (the method and
the muffler elements); Dokumaci, *Duct Acoustics*, Cambridge 2021 (the same with flow, the ADEM program's basis);
Blair, *Design and Simulation of Four-Stroke Engines*, SAE 1999 (the gas-dynamic side: the one Rienstra and Munjal
leave out, and what OpenWAM solves).

## More texts read against the code (2026-11-04, evening; the user's copies)

| Text | Finding | Change |
|---|---|---|
| Bodén, Glav & ter Riet, *Sound transmission through a 90° bend with flow*, ICSV6 1999 (KTH MWL, measured two-ports, M 0-0.09) | a smoothly curved bend (R/d 2.2) transmits plane waves almost as a straight duct (transmission near 1, little reflection) below 0.3 of the cut-on; sharp bends (R/d 0.5) reflect noticeably; flow to M 0.09 lowers the upstream transmission a little at low frequency | none: mandrel bends (CLR 1.5-2 D) as straight lengths, which every model here does, is justified |
| Hamilton & Blackstock, *Nonlinear Acoustics*, 3rd ed. 2024 | shock formation distance x = rho0 c0^3 / (beta f'max) (eq. 4.27): for 6 kPa at 390 Hz about 3 m, so a 600 mm tailpipe moves about 10 % of the firing fundamental into its second harmonic (order 8) | none: OpenWAM solves the nonlinear flow inside the pipes, so this is in the model; past the tip the amplitude falls too fast to steepen further |
| Howe, *Theory of Vortex Sound*, 2003 | Lighthill's v^8 law (2.2), vortex sound at apertures (8.6): the theory behind the orifice losses (Rienstra 4.4.3) and the jet noise already in the code | none |
| Crighton, *Basic Principles of Aerodynamic Noise Generation*, Prog. Aerospace Sci. 1975 | the standard review: source convection and jet directivity | none; our jet radiates evenly (a real jet peaks 30-40 deg off its axis), noted in jet_noise.md |
| Rodriguez, *Applied CFD and Turbulence Modeling* 2019; Nieuwstadt et al., *Turbulence* 2016; Al Makky, *Coding Tutorials for CFD* 2014 | CFD background | the intake/collector CFD side, not the sound; not read against the code |

## The full reading pass (2026-11-05; four reader agents over the Drive folder and the extracted books, reports kept in the session scratchpad)

What was coded from it, with the source behind each:

| Text | Finding | Change |
|---|---|---|
| Munjal 1987, 2.13-2.14, 3.7 | extended inlet/outlet pockets as closed quarter-wave shunts of area S2 - S1; double-tuned at L/2 and L/4 | Mufflers: extended-tube chamber, reverse-flow end chamber (reversal elements back to back) |
| Munjal 1987, 3.8.1, eqs 3.120/3.122/3.153 | cross-flow expansion and contraction elements; Sullivan's cross-flow perforate impedance | Mufflers: plug muffler curve and section |
| Morse & Ingard 9.1 (9.1.31-35) | chain of chambers as a ladder filter: f0, cut-off 2 f0, 8.69 acosh(...) dB per chamber | Mufflers: baffled chambers curve |
| Morse & Ingard 11.1, 11.3 | (1 - M^2) shift of tuned lengths; Strouhal 0.2 shedding from probes | Sound: notes with the engine's own Mach number |
| Davies 1996, data sheet 3 | open-end reflection magnitude R0(ka) (Levine-Schwinger fit; two misprinted coefficients corrected) | Sound: peak height and width of every pipe mode |
| Rienstra & Hirschberg 4.5.3, 5.2.2 | wall damping alpha = (1/ac) sqrt(omega nu/2)(1 + (gamma-1)/sqrt Pr) | same row |
| Rienstra & Hirschberg 5.6 | shear-layer coincidence f = 0.4 n U / w over a branch mouth | Mufflers: J-pipe whistle row |
| Rienstra & Hirschberg 8.3 | first-harmonic resistance (4K/3 pi) rho u of a quadratic neck loss | Mufflers: real peak of a can or J-pipe at a stated tone level |
| Davies 1996 §2.2 | chamber and tailpipe lengths must not be commensurate | Mufflers: ratio check against the tailpipe length |
| Ji 2005 via Calton & Sommerfeldt 2017 | side-branch end correction falls with branch/main diameter ratio | Mufflers: J-pipe mouth correction (was a flat 0.3 d) |
| Joseph, ISVR duct acoustics | rectangular/flat-oval cut-on c/2W | Mufflers: flat-oval pipe limit |
| Liu, Hao & Liu 2012 | measured Mach 0.13-0.30 at a muffler inlet | Mufflers: Mach from the engine beside the input |
| Blair & Cahoon via the Perth College thesis | Cd(PR) of the best bell; lip radius 3 mm on 49 mm | Intake: Cd(PR); source note corrected |
| Engelman 1973 | composite runner sum L/A; K 2.0-2.5; feeder 1.19 x; <= 4 cylinders per plenum; orifice + volume = third resonance | Intake: tapered runner, K band, plenum row |
| Bell, Maximum Boost | charge-pipe Mach 0.4, 1 %/90 deg, joint load, intercooler 6 in^2/100 hp at 45 % open face, core drop < 2 psi, TIP 2-2.5 x boost | Intake: charge-pipe rows and turbo note |
| Vizard, Ford SOHC | filter constants 25,500/20,900/18,870; 4-1 against 4-2-1 by cam | Intake filter row; Headers Tri-Y note |
| Grape Ape, Bell | plenum percentages by cylinders and rpm | Intake plenum row |
| nsxprime materials table | Inconel 625, sensitisation window | Sound: material and note |
| Saadabadi 2023 | baffle-hole back-pressure ratios | Mufflers tips |
| Davies 1996 case studies; Bönnen (NVH ch. 6) | 60 % more volume for straight-through chambers; diffuse steps; valve 2-10 kPa, velocity antinode | Mufflers tips |

Read and not coded (kept for later): Munjal's flow terms in the extended-tube matrices (eq 3.97, K from Table 3.1); the
amplitude-dependent neck loss inside the OpenWAM line (it already has loss_K); Morse's slot end correction (logarithmic
in width) for the Spintech trap; the open-end radiation impedance with mean flow (Davies DS3 outflow curve is a plot
only); Davies' attenuation index with the real termination in place of TL; Harrison & Dunkley's one-oscillation rule
(second hand, read the JSV originals first); the Samara multi-hole nozzle (pitch = hole diameter); the Davies
quiet-target band arithmetic (needs an absolute level, which the page only has from OpenWAM). Not in hand: Smith &
Morrison, *Scientific Design of Exhaust and Intake Systems* (the file under that name is Smith & Wenner); the SAE heat
transfer deck's exhaust part (Drive returned 80 of its slides).
