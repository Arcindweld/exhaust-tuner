# Why the Outback model is too bright (2026-11-04)

The OpenWAM model of the owner's 2004 Outback (validation/outback-2004/model) puts too much sound in the upper orders
against the fixed-gain recording. The difference (recording minus model, both relative, mean offset removed) tilts
against frequency at every steady hold, orders 2 to 12:

| Hold | Tilt, dB per octave |
|---|---|
| 1915 rpm (the AGC clip) | -6.0 |
| 1980 rpm | -4.4 |
| 2585 rpm | -8.5 |
| 2955 rpm | -10.0 |
| 3550 rpm | -5.9 |

The same synthesis on the RS 660 (stock muffler; validation/rs660-2026) shows no such tilt: -0.5 to +1.8 dB per octave
at the three idle clips, +8.4 at the 5460 rpm hold. So the method is not biased toward bright; it is the Outback's
parts after the engine that take out more high frequency than the model has. In the model, the owner's Spintech 3331
is an empty 7.24 L box and the catalyst is 100 mm of plain pipe.

A single tilt, fitted on three holds and used on the fourth (leave one out), lowers every hold's RMS: 10.5 -> 10.4,
10.3 -> 8.2, 12.3 -> 10.2, 9.8 -> 8.9 dB (10.8 -> 9.5 over all four). The slope over all four is -7.2 dB per octave.
What is left (about 9.5 dB) is order by order, mostly the half orders, which hang on the manifold's runner lengths
(placeholders until measured).

What a Spintech holds is not published: the design matches US 5,824,972 (Butler, 1997): rectangular case, three to six
spiral traps of 14-20 gauge sheet bent a little over one turn, standing from the case's top to its bottom, their
openings facing the main flow, vents in their backs drawn out by a venturi along the case wall, no packing. The patent
gives no sizes and no frequency data, and no cutaway of a 3331 was found. Each trap is a cavity behind a slot, which is a
side resonator of a few hundred cm3; at exhaust temperature a trap that size behind a 15-20 mm slot tunes in the high
hundreds of Hz, which is where the model is brightest. That is a likely mechanism, not a measured one.

How much of it can the catalyst be? A 400 cpsi brick (6.5 mil walls: 1.10 mm channels, 76 % open) 100 mm long at
300 C, by Kirchhoff's viscothermal attenuation in each channel (wide-tube form, (1/(r c)) sqrt(omega nu / 2)
(1 + (gamma - 1)/sqrt(Pr)) Np/m), takes off 0.6 dB at 100 Hz, 0.8 at 200, 1.2 at 400, 1.6 at 800 and 2.3 at 1600 Hz:
a tilt of about -0.5 dB per octave. Below a few hundred Hz the boundary layer (0.2-0.4 mm) is not thin against the
0.55 mm channel radius, so the wide-tube form reads low there, but even doubled it stays near 1 dB per octave. The
catalyst explains at most a small part of the -7; the Spintech, as an empty box, is the larger miss.

The page's "Compare a recording" now reports this tilt and the RMS with it removed, for any build and recording.

To close the gap with data rather than a fitted slope: the Spintech's inside (trap count, size, slot width; a borescope
through the outlet would show them), and the catalyst's size and cell density.
