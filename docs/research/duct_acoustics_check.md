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
| 4.4.2 area change | a gradual area change reflects little; a sudden one by (A1 - A2)/(A1 + A2) | OpenWAM's union BC (Borda-Carnot) and the page's transfer matrices | none |

Still to read against the code: 7 (duct modes and the open end's reflection and radiation: our monopole-with-piston
directivity), 5.2.2 (resonance of a duct segment, our quarter-wave branches), 8.3 (the multiple-scales treatment of
a lossy neck, for a frequency-dependent K), and 2.5 / 3.2.5 (mean-flow effects on propagation and impedance).

## The library (2026-11-04)

Open-access texts found and read against the code (kept in the session scratchpad, not the repository; each is on its
publisher's or author's own server):

| Text | What it is | Read for |
|---|---|---|
| Rienstra & Hirschberg, *An Introduction to Acoustics*, TU/e 2004 (pure.tue.nl, 372 pp.) | the free duct-acoustics text | the table above: end corrections, orifice losses, flow damping |
| Zhou & Bodén, *Experimental investigation of an in-duct orifice with bias flow under medium and high level acoustic excitation*, KTH MWL, 2013 (mediatum.ub.tum.de, 12 pp.) | measurements of a 6 mm orifice, 0-19 m/s through it, 100-155 dB | **discharge coefficients 0.6-0.7 when the flow is turbulent (loss 1/Cc^2 = 2-2.8 velocity heads; 0.8 at low Reynolds number)**; the resistance with bias flow about U / (c0 Cc_M Cc), linear in the flow; end correction (pi/4) r a side, falling at high level; the thin edge far more level-sensitive than the 3 mm one. Our v11 loss element and K 2.8 for a sharp edge sit inside these numbers |
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
