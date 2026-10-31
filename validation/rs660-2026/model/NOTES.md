# 2026 Aprilia RS 660, stock exhaust: first OpenWAM model against the owner's recording

Model: `rs660.py` (every number is tagged in its docstring: sourced from `../stock_exhaust_research.md`, estimated, or a
calculator default). Nothing dimensional about the stock exhaust is published, so the pipe lengths and diameters, the
catalyst, the box volume and the outlets are all estimates until they are measured (research doc, section 6).

What is new in the tools for this bike:
- the OpenWAM writers (`openwam/make_wam.py`, `wam_export.js`, the page) take a muffler box with several exits:
  `{"outlets": [[segments], [segments]]}` as the last tail element after a plenum. Both writers give the same bytes
  (98/98 parity cases), and a one-outlet list writes exactly the plain chain.
- `sound/wam_sound.py synthesize_multi()`: several open ends heard at one microphone, each a compact monopole at its own
  distance and angle, summed coherently with the path difference (two coincident identical outlets give +6.02 dB on
  every order, as they must).

Runs (no load: each intake runner fed from a reservoir at the manifold pressure that makes NMEP = FMEP, calibrated per
speed from three short runs): idle 1442 rpm at 0.257 bar, the 5460 rpm hold at 0.305 bar. Both outlets carry the same
mean flow (3.7 g/s each at the hold).

Against the recording (relative order levels, gain offset removed; orders below 60 Hz left out for the phone-class mic):

| point | recording segment | orders compared | RMS difference |
|---|---|---|---|
| idle 1442 rpm | idle_after (27.5-31 s) | 2.5-7 | 10.1 dB |
| idle 1442 rpm | idle_warm / idle_start | 2.5-7 | 10.6 dB |
| hold 5460 rpm | hold_5400 (24.2-26.4 s) | 1-7 | 8.0 dB |

Level change from idle to the 5460 rpm hold: model +13.9 dB, recording +12.0 dB (fixed gain).

Reading it: the overall level trend with speed is right within 2 dB, and at the hold orders 1, 4.5, 6.5 and 7 are
within 3 dB. The balance between the strongest orders is not: the recording's strongest order at 5460 rpm is 1.5
(136 Hz) with 2.5 close behind; the model's is 2 (182 Hz), with 2.5 12 dB too low. Those orders sit where the estimated
header lengths put the pipe resonances, so this is the first thing the measured lengths will move. Above order 7
(640 Hz at the hold) the recording keeps 20-25 dB below its peak while the model falls away: engine mechanical, intake
and flow noise reach the microphone there and the model has none of them, so those orders are not compared.

How much the header lengths matter (5460 rpm hold, both headers changed together, everything else the same):

| header length change | RMS vs recording (orders 1-7) | order 1 | 1.5 | 2 | 2.5 | 3 (dB rel) |
|---|---|---|---|---|---|---|
| recording | | -4.9 | 0.0 | -12.4 | -2.8 | -15.3 |
| -50 mm | 5.4 dB | 0.0 | -2.2 | -0.9 | -7.4 | -14.0 |
| as estimated (575 / 625 mm) | 8.0 dB | -5.4 | -4.7 | 0.0 | -16.2 | -31.3 |
| +50 mm | 6.2 dB | 0.0 | -5.0 | -5.9 | -19.0 | -13.9 |
| +100 mm | 6.9 dB | 0.0 | -2.2 | -4.3 | -9.6 | -22.2 |

A 50 mm change moves single orders by up to 17 dB, so the order balance cannot be judged until the lengths are
measured; picking the length that fits best would be fitting the model to the recording, not checking it.

Next: the owner's measurements (research doc section 6, most of all the two header centreline lengths and the step
position, the box volume and the outlet tubes, and where the microphone was relative to each outlet).
