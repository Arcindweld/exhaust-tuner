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
