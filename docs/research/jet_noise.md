# Jet noise at the tip

The 1-D model gives the tailpipe's pulsing flow, which is the tonal part of an exhaust's sound. The hot jet leaving the
tip also radiates broadband noise from its turbulent mixing, which the 1-D model has none of. `sound/realism.py`
(`jet=`) and the page's A/B listening (Sound tab, "Jet noise at the tip") now add it.

- Power: Lighthill's eighth-power law, W = K rho0 U^8 D^2 / c0^5. K is quoted between about 3e-5 and 1.2e-4
  (Goldstein, *Aeroacoustics*, 1976); 6e-5 is used, so the absolute level is good to about +-3 dB.
- Hot gas: the intensity goes as (rho_j / rho0)^omega, omega = 3 M^3.5 / (0.6 + M^3.5) - 1 (Hoch, Duponchel,
  Cocking and Bryce, 1973, the form SAE ARP876 uses). At exhaust speeds omega is close to -1, so a jet at twice ambient
  temperature is about 3 dB louder than a cold one at the same speed.
- Spectrum: broadband, the third-octave level peaking at f D / U = 0.2, rising 6 dB per octave below and falling 3 above
  (a smooth stand-in for the fine-scale similarity spectrum of Tam, Golebiowski and Seiner, 1996).
- Pulsing: the instantaneous power follows U(t)^8 at the open end, from OpenWAM's own velocity and temperature there,
  and each firing's flow gain g scales its jet pressure by g^4. This is what makes the roar pulse with the firing.
- Free field: p^2 = rho0 c0 W / (4 pi r^2), with no directivity. A jet radiates most at 30-40 deg off its axis and a
  few dB less at 90 deg.

What it does on the two cases:

| Case | Tip gas (OpenWAM) | Jet against the pulses |
|---|---|---|
| Outback, 1980 rpm no load | up to 36 m/s | -70 dB: inaudible |
| F-100 302, 5800 rpm WOT (X 400 mm, chambered) | 119 m/s mean, 805 K | -15 dB: the floor between the orders rises from about -45 to -28..-35 dB |

At full throttle it is a real part of the sound between the orders. But the F-100 recording's floor (-20 to -26 dB) is
higher still: on a moving truck, road, tyre and wind noise make up the rest. It does not supply the firing harmonics
(orders 8 and 12) that the model has too weak.

Checks: `sound/test_realism.py` (the U^8 law, the hot-jet term, the peak frequency and the absolute level of a steady
jet) and `web/tests/rec_ui.js` (the page's diameter from the flow, its level and the law).

# Muffler shell radiation

`sound/realism.py` `shell_flow()` (used through `realize(extra=)`): the pressure inside a muffler chamber drives its
broad faces as a panel on a spring, v = p_in / Z, Z = j w m (1 - (f11 / f)^2 (1 + j eta)) (single-mode panel, Fahy and
Gardonio, *Sound and Structural Vibration*, ch. 2). The faces that breathe in phase are a compact monopole of volume
velocity S v, so they add to the tailpipe's outflow as rho0 S v. f11 for a simply supported flat plate:
(pi / 2) sqrt(D / m) (1 / a^2 + 1 / b^2). Checked: mass law above f11, 1/eta times it at f11, stiffness control below.

On the F-100 (both chambers of the near exit's muffler, 1.5 mm steel, eta 0.03, both broad faces):

| Faces as | f11 | Shell against the tailpipe, orders 4 / 8 / 12 | Clipped RMS against the pulls |
|---|---|---|---|
| (no shell) | | | 4.1-6.8 dB |
| whole 14 x 9 in flat faces | 97 Hz | order 1 +42 dB (the mode sits on order 1 at 5800 rpm) | 11.3-12.9 dB: ruled out |
| split in three by the internal baffles, 119 x 229 mm | 322 Hz | +2 / +1 / 0 dB | 4.6-7.1 dB |
| the same, eta 0.1 | 322 Hz | +2 / +1 / 0 dB | 4.8-7.0 dB |

So a flat, unbraced face whose first mode lands on a strong order would dominate, and the recording rules that out for
this muffler. Braced by its baffles, a thin flat-faced case radiates about as much as its tailpipe in this model, which
is an upper bound: the whole face area is taken as moving in phase. The recording neither needs it nor rules it out,
so it stays an option, off by default. The case's real gauge, curvature and bracing would decide it.

# The intake as a second source

OpenWAM writers v12 (`ins_intake` run setting) record the intake's open end (the air-filter end of the plenum inlet, or
each runner's mouth), and `read_ins(intake=True)` / `readIns({intake})` read it; its flow is positive into the engine, so
the radiated outflow is its negative. On the F-100 at 5800 rpm WOT (single plane with a shared plenum, one 86 mm inlet
behind a 100 mm stack, open to the air), the bare intake mouth radiates 103 dB against the tailpipe's 97 at the same
distance, mostly on orders 2, 4.5 and 5 (where the exhaust has little), the firing order 10 dB below the exhaust's. A
bare stack is this loud in life too; in the truck the mouth is under the hood behind an air filter, and the pass-by
recording is beside the exits, so the intake is left out of that comparison. It is the first thing to add for a cab or
hood-open recording, with the hood and filter as a transmission loss to be measured or estimated.
