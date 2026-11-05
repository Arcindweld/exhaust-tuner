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
